import type { ProviderError } from "./types";

export class AnalystServiceError extends Error {
  readonly code: ProviderError["code"];
  readonly safeMessage: string;
  readonly retryable: boolean;

  constructor(error: ProviderError) {
    super(error.safeMessage);
    this.name = "AnalystServiceError";
    this.code = error.code;
    this.safeMessage = error.safeMessage;
    this.retryable = error.retryable;
  }
}
