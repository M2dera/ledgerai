"use client";

type FileUploadProps = {
  onFileSelect: (file: File) => void;
};

export default function FileUpload({ onFileSelect }: FileUploadProps) {
  return (
    <label className="bg-green-500 hover:bg-green-600 text-black font-semibold px-8 py-4 rounded-xl text-lg cursor-pointer">
      Upload Financial File
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];

          if (file) {
            onFileSelect(file);
          }
        }}
      />
    </label>
  );
}