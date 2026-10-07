"use client";

import { useRef } from "react";
import { useLedgerData } from "@/components/providers/LedgerProvider";

export default function FileUpload({ onSuccess }: { onSuccess?: () => void }) {
  const { uploadFeedback, uploadFile } = useLedgerData();
  const inputRef = useRef<HTMLInputElement>(null);
  const isLoading = uploadFeedback.status === "loading";

  return (
    <section className="space-y-4">
      <label className={`inline-flex bg-green-500 hover:bg-green-600 text-black font-semibold px-8 py-4 rounded-xl text-lg ${isLoading ? "cursor-wait opacity-70" : "cursor-pointer"}`}>
        {isLoading ? "Analyzing file…" : "Upload Financial File"}
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          disabled={isLoading}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadFile(file).then((succeeded) => { if (succeeded) onSuccess?.(); });
            event.target.value = "";
          }}
        />
      </label>

      {uploadFeedback.message && (
        <div
          role={uploadFeedback.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`rounded-xl border p-4 text-sm ${uploadFeedback.status === "error" ? "border-red-500/50 bg-red-500/10 text-red-300" : uploadFeedback.status === "loading" ? "border-zinc-700 bg-zinc-900 text-zinc-300" : "border-green-500/40 bg-green-500/10 text-green-300"}`}
        >
          <p>{uploadFeedback.message}</p>
          {uploadFeedback.errors.length > 1 && (
            <ul className="mt-2 list-inside list-disc">{uploadFeedback.errors.slice(1).map((error) => <li key={error}>{error}</li>)}</ul>
          )}
          {uploadFeedback.warnings.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-yellow-300">{uploadFeedback.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          )}
        </div>
      )}
    </section>
  );
}
