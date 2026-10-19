export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

export const fail = (status: number, code: string, message?: string): never => {
  throw new HttpError(status, code, message);
};

// Minimal JSON-schema builders so every route validates its input.
type J = Record<string, unknown>;
export const S = {
  str: (o: J = {}) => ({ type: 'string', maxLength: 2000, ...o }),
  nstr: (o: J = {}) => ({ type: ['string', 'null'], maxLength: 2000, ...o }),
  int: (o: J = {}) => ({ type: 'integer', ...o }),
  nint: (o: J = {}) => ({ type: ['integer', 'null'], ...o }),
  num: (o: J = {}) => ({ type: 'number', ...o }),
  nnum: (o: J = {}) => ({ type: ['number', 'null'], ...o }),
  bool: () => ({ type: 'boolean' }),
  uuid: () => ({ type: 'string', format: 'uuid' }),
  nuuid: () => ({ anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] }),
  enum: (values: string[]) => ({ type: 'string', enum: values }),
  nenum: (values: string[]) => ({ type: ['string', 'null'], enum: [...values, null] }),
  arr: (items: J, o: J = {}) => ({ type: 'array', items, maxItems: 5000, ...o }),
  obj: (properties: Record<string, J>, required: string[] = [], o: J = {}) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
    ...o,
  }),
  any: () => ({}),
};

export const idParam = S.obj({ id: S.uuid() }, ['id']);

export function toCsv(rows: Record<string, unknown>[], columns: string[]) {
  const esc = (v: unknown) => {
    let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n');
}
