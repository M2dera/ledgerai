"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type FinancialChartProps = {
  revenue: number;
  expenses: number;
  profit: number;
};

export default function FinancialChart({
  revenue,
  expenses,
  profit,
}: FinancialChartProps) {
  const data = [
    {
      name: "Revenue",
      value: revenue,
      color: "#00d26a",
    },
    {
      name: "Expenses",
      value: expenses,
      color: "#ef4444",
    },
    {
      name: "Profit",
      value: profit,
      color: "#3b82f6",
    },
  ];

  return (
    <div className="mt-8 rounded-xl border border-zinc-700 bg-zinc-900 p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">
          📊 Financial Overview
        </h2>

        <p className="mt-1 text-zinc-400">
          Visual comparison of revenue, expenses, and profit.
        </p>
      </div>

      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{
              top: 30,
              right: 20,
              left: 0,
              bottom: 0,
            }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#3f3f46"
              vertical={false}
            />

            <XAxis dataKey="name" stroke="#a1a1aa" />

            <YAxis
              stroke="#a1a1aa"
              tickFormatter={(value) =>
                Number(value).toLocaleString()
              }
            />

            <Tooltip
              formatter={(value, _name, item) => [
                `${Number(value).toLocaleString()} KD`,
                item.payload.name,
              ]}
              contentStyle={{
                backgroundColor: "#18181b",
                border: "1px solid #3f3f46",
                borderRadius: "12px",
              }}
              labelStyle={{
                color: "#ffffff",
              }}
            />

            <Bar
              dataKey="value"
              radius={[8, 8, 0, 0]}
              animationDuration={900}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={entry.color}
                />
              ))}

             <LabelList
  dataKey="value"
  position="top"
  formatter={(value) =>
    `${Number(value).toLocaleString()} KD`
  }
  fill="#ffffff"
/>
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}