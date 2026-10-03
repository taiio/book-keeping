export interface LookupDefinition {
  readonly id: number | null;
  readonly code: string | null;
  readonly name: string;
  readonly description: string;
}

export type LookupRow = {
  id: number;
  code: string;
  name: string;
  description: string;
};
