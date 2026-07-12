type SuggestedQuestionsProps = {
  onSelect: (question: string) => void;
};

const questions = [
  "Why did my profit decrease?",
  "What are my highest expenses?",
  "Summarize my revenue performance.",
  "Compare this month with last month.",
];

export default function SuggestedQuestions({
  onSelect,
}: SuggestedQuestionsProps) {
  return (
    <div className="mb-6 grid gap-3 md:grid-cols-2">
      {questions.map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onSelect(question)}
          className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-left text-zinc-300 transition hover:border-green-500 hover:bg-zinc-800 hover:text-white"
        >
          {question}
        </button>
      ))}
    </div>
  );
}