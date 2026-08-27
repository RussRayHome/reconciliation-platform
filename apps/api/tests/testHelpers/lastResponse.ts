import type request from 'supertest';

export type ObservedResponse = {
  method: string;
  url: string;
  sentCorrelationId: string;
  response: request.Response;
};

let observed: ObservedResponse | null = null;

export const recordObservedResponse = (entry: ObservedResponse): void => {
  observed = entry;
};

export const clearObservedResponse = (): void => {
  observed = null;
};

export const takeObservedResponse = (): ObservedResponse | null => observed;

/**
 * Issue #192: two failures were recorded as `expected 400 to be 501` and `expected 400 to be 200`,
 * which names neither WHICH 400 arrived nor which request produced it. Every 400 this API can emit
 * is distinguishable by its body -- a zod message names the field and constraint, express.json's
 * names the parse error -- and a Node-level `400 Bad Request` (emitted by the HTTP parser before
 * Express runs at all) is identifiable by carrying an empty body and ZERO response headers.
 */
export const describeResponse = (response: request.Response): string => {
  const headerNames = Object.keys(response.headers ?? {});
  const body = typeof response.text === 'string' ? response.text : '';

  return [
    `status=${response.status}`,
    `headerCount=${headerNames.length}`,
    `headers=[${headerNames.join(', ')}]`,
    `bodyBytes=${body.length}`,
    `body=${JSON.stringify(body.slice(0, 500))}`,
  ].join(' ');
};
