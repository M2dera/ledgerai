import type { Alert } from "@/lib/financial/types";

type SmartAlertsProps = { alerts: Alert[] };

export default function SmartAlerts({ alerts }: SmartAlertsProps) {
  const styles = {
    high: "border-red-500 bg-red-500/10 text-red-300",
    medium: "border-yellow-500 bg-yellow-500/10 text-yellow-300",
    good: "border-green-500 bg-green-500/10 text-green-300",
  };

  return (
    <section className="mt-8 rounded-xl border border-zinc-700 bg-zinc-900 p-6">
      <h2 className="text-2xl font-bold text-white">Financial Alerts</h2>
      <p className="mt-1 text-zinc-400">Rule based observations from the analyzed dataset.</p>
      <div className="mt-6 space-y-4">
        {alerts.map((alert) => <div key={alert.id} className={`rounded-xl border p-4 ${styles[alert.level]}`}>{alert.message}</div>)}
      </div>
    </section>
  );
}
