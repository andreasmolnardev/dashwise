import { z, type ZodTypeAny } from "zod";

export type GetContract<Response extends ZodTypeAny> = {
  summary: string;
  tags: string[];
  query: ZodTypeAny;
  response: Response;
};

export function defineGetContract<Response extends ZodTypeAny>(
  contract: GetContract<Response>,
) {
  return contract;
}

export function shouldValidateContractResponses() {
  return Bun.env.NODE_ENV !== "production";
}

export function validateContractResponse<Response extends ZodTypeAny>(
  contract: GetContract<Response>,
  value: unknown,
) {
  return shouldValidateContractResponses() ? contract.response.parse(value) : value;
}

export function validateContractQuery(
  contract: GetContract<ZodTypeAny>,
  value: unknown,
) {
  return contract.query.parse(value);
}

export const emptyQuerySchema = z.object({}).strict();
