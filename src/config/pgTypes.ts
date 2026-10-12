import { PG_TYPE_OID } from '../constants/database';
import { parseBigIntColumn } from '../helpers/bigint';

const { types } = require('pg');

types.setTypeParser(PG_TYPE_OID.INT8, parseBigIntColumn);
