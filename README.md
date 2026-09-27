# book-keeping

Double-entry ledger service (Deposit / Withdraw / Stake) với gRPC API.

## Cấu trúc thư mục

```
proto/bookkeeping.proto     Định nghĩa gRPC API ra bên ngoài
scripts/sync-db.ts          Script seed constants + sync schema (chạy tay, không nằm trong src/)

src/
  index.ts                  Entrypoint: connect DB, start gRPC server, graceful shutdown
  config/
    env.ts                  Đọc toàn bộ config qua env var (12-factor)
    database.ts             Khởi tạo Sequelize instance
  constants/                Enum nghiệp vụ (BOOK_PURPOSE, TRANSACTION_STATE, ...)
  models/                   Sequelize models (Book, BookPosting, JournalTransaction, ...)
  repositories/             Data-access layer (1 repository / model), có interfaces/ cho params/return type
  common/
    UnitOfWork.ts            Bọc transaction Sequelize
    errors.ts                 Error class nghiệp vụ (NotFoundError, InsufficientBalanceError, ...)
  di/
    container.ts             tsyringe container (autoInjectable + singleton)
  domain/                     (trước đây là "logics/") — nghiệp vụ chính, chia theo flow
    shared/                   Logic DÙNG CHUNG giữa các flow (xem bên dưới)
    deposit/DepositFlow.ts
    stake/StakeFlow.ts
    withdraw/
      WithdrawFlow.ts         Orchestrator (mỏng — chỉ điều phối)
      types.ts                WithdrawRequest, WithdrawKind, WithdrawTargetState
      withdrawStateSequence.ts FSM: chuỗi state hợp lệ theo từng kind
      balanceCheck.ts          Pre-flight kiểm tra đủ số dư trước khi tạo journal
      bucketMovement.ts        moveBucket() / refund khi advance() sai thứ tự
  grpc/                        API ngoài (external)
    server.ts                 Load proto, bind, graceful shutdown
    bookkeepingService.ts      Handler — chỉ map + gọi domain/, KHÔNG chứa nghiệp vụ
    mappers.ts                 Convert proto message <-> domain request/response
    errorMapping.ts             Domain error -> gRPC status code
  test/
    run.ts                     Kịch bản test thủ công, cần DB thật
    diSanityCheck.ts            Kiểm tra tsyringe autoinject, KHÔNG cần DB
```

## Vì sao tổ chức lại như vậy

- **`logics/` → `domain/` + tách theo flow**: mỗi flow (deposit/stake/withdraw) có thư mục
  riêng thay vì 1 file phẳng. `WithdrawFlow.ts` từ 662 dòng (chứa cả state machine, balance
  check, di chuyển bucket, refund...) được tách thành 5 file nhỏ, mỗi file 1 trách nhiệm.
- **`domain/shared/`** — trước khi tách, mọi flow tự copy-paste 2 khối logic:
  1. Mở/tạo 1 "Book" (bucket) với ~9 field giống hệt nhau -> gom vào `openBook()`.
  2. Tạo 2 posting đối ứng (trừ 1 book, cộng 1 book, cùng journal, token suy ra từ
     `idempotencyToken` gốc) -> gom vào `postDoubleEntry()`.

  Riêng `WithdrawFlow.ts` cũ lặp lại khối (1) tới 6 lần và khối (2) ở cả `create()`,
  `moveBucket()`, `refundBucketToClient()`. Sau khi gom, mọi flow gọi chung 2 hàm này —
  sửa cách sinh token / thêm audit field chỉ cần sửa 1 chỗ, không sợ 3 flow lệch nhau.
- **Dọn code chết**: `BookRepository` có 3 method (`getAvailableBalance`, `reserveBalance`,
  `finalizeReservedBalance`) tham chiếu cột `availableBalance`/`lockedBalance` **không tồn
  tại** trên model `Book`, và dùng string literal sai kiểu cho `bookPostingPurposeId`
  (lẽ ra phải là số, theo `BOOK_POSTING_PURPOSE`). Không nơi nào gọi tới 3 method này —
  đã xoá cùng 1 field constructor không dùng (`private readonly bookPosting`).
- **`WithdrawFlow.create()`** cũ mở lại 2 book (`internalbook`, `custodyFeeBook`) trùng
  hệt 2 book đã được `assertSufficientBalanceOrThrow()` mở + lock ngay phía trên
  (cùng bookPurposeId + cùng state + cùng asset -> cùng 1 row DB) — bỏ 2 lệnh gọi
  `getOrCreateBook` thừa này, hành vi/token không đổi, chỉ bớt round-trip DB thừa.
- **`src/index.ts`** trước đây **không tồn tại** dù `package.json` có script `"start":
  "ts-node src/index.ts"` — đã bổ sung, kèm graceful shutdown (SIGTERM/SIGINT).
- **`sync-db.ts`** chuyển vào `scripts/` (đúng như `tsconfig.json` đã include sẵn
  `scripts/**/*.ts` — có vẻ ý định ban đầu là đặt ở đây nhưng bị bỏ quên).

## gRPC API (external)

Định nghĩa tại `proto/bookkeeping.proto`, gồm: `CreateDeposit`, `ConfirmDeposit`,
`CreateWithdrawal`, `AdvanceWithdrawal`, `CreateStake`, `Unstake`, `HealthCheck`.

Load động bằng `@grpc/proto-loader` (không cần bước codegen riêng). Layer `grpc/` chỉ
map dữ liệu + gọi `domain/` — không chứa nghiệp vụ, nên có thể thêm 1 cổng vào khác
(REST, GraphQL...) dùng chung `domain/` mà không đụng gì tới logic ledger.

```bash
npm run start          # ts-node src/index.ts — kết nối DB + start gRPC server
```

Amount/fee trên wire là **string** (giữ nguyên precision, không đi qua double/float).
Timestamp là **ISO-8601 string** (không dùng `google.protobuf.Timestamp` để tránh phụ
thuộc thêm include-path cho well-known types).

## Scale ngang (horizontal scaling)

- **Stateless**: mọi state thực sự nằm ở Postgres qua `UnitOfWork`/transaction; Flow là
  singleton *trong 1 process* nhưng không giữ state nghiệp vụ nào giữa các request ->
  chạy N instance song song sau load balancer là an toàn.
- **Idempotency**: mọi posting đều có `idempotencyToken` suy ra deterministic (xem
  `domain/shared/doubleEntryPosting.ts`) — request bị gửi lại (do client retry, hoặc do
  load balancer route sang instance khác) không tạo double-posting.
- **Config qua env** (`src/config/env.ts`): pool size DB, gRPC port, max concurrent
  streams... đều chỉnh qua env var — cùng 1 image chạy nhiều instance chỉ khác env,
  không khác code. Khi tăng số instance, cần **giảm `DB_POOL_MAX`** tương ứng để tổng
  connection không vượt `max_connections` của Postgres.
- **Graceful shutdown** (`src/index.ts`): nhận `SIGTERM` -> ngừng nhận request gRPC mới
  (`server.tryShutdown`) -> đợi request đang xử lý xong (tối đa `SHUTDOWN_GRACE_PERIOD_MS`)
  -> đóng connection pool DB -> exit sạch. Cần thiết cho rolling deploy / autoscale-down
  không làm rớt transaction đang chạy dở.
- **`HealthCheck` RPC**: dùng làm readiness/liveness probe cho load balancer hoặc
  orchestrator (k8s, ECS...).
- **Khoá theo thứ tự** (`bookRepository.lockBooksInOrder`): mọi nơi lock nhiều book cùng
  lúc đều lock theo thứ tự `id` tăng dần — tránh deadlock khi nhiều instance cùng động
  vào 2 book chung theo thứ tự khác nhau.

## Scripts

```bash
npm run build        # tsc --noEmit
npm run start         # chạy service (DB + gRPC)
npm run dev            # như start, transpile-only (nhanh hơn khi dev)
npm run sync-db         # seed constants + sync schema
npm run test:di          # kiểm tra DI/autoinject, KHÔNG cần DB
npm run test:manual       # kịch bản test thủ công, CẦN DB thật
npm run format             # prettier --write
```
