import results from "../../../eval/results.json";

export default function Eval() {
  const r = results as unknown as {
    ranAt: string; planted: number; recovered: number; falseFlags: number; identicalOnRerun: boolean;
    workbooks: { file: string; payees: number; plantedDefects: number; recovered: number; falseFlags: number; overpaid: number; underpaid: number; topAmbiguity: { clause: string; dollarsAtStake: number } | null }[];
  };
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Offline eval · <span className="font-mono normal-case">npm run eval</span></p>
        <h1 className="font-serif text-4xl font-semibold mt-1">Does the engine catch what we planted?</h1>
        <p className="text-sm text-muted mt-1 max-w-3xl">Three illustrative workbooks, including a clean control. Each defect is planted on purpose and labelled. This tests the deterministic engine and diagnosis (rules given), plus 8 hand-computed unit tests. It is a regression test, not proof of real-world accuracy — that comes from the user-correction and false-flag metrics once live.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Box label="Planted defects recovered" value={`${r.recovered}/${r.planted}`} />
        <Box label="False flags" value={String(r.falseFlags)} />
        <Box label="Identical output on re-run" value={r.identicalOnRerun ? "Yes" : "No"} />
        <Box label="Model used for money" value="None" />
      </div>
      <div className="rounded-2xl border border-line bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper text-xs text-muted"><tr><th className="text-left p-3">Workbook</th><th className="p-3">Payees</th><th className="p-3">Planted</th><th className="p-3">Recovered</th><th className="p-3">False flags</th><th className="text-right p-3">Over / under</th><th className="text-left p-3">Most expensive ambiguity</th></tr></thead>
          <tbody className="divide-y divide-line">
            {r.workbooks.map((w) => (
              <tr key={w.file}>
                <td className="p-3 font-mono text-xs">{w.file}</td><td className="p-3 text-center">{w.payees}</td><td className="p-3 text-center">{w.plantedDefects}</td>
                <td className="p-3 text-center">{w.recovered}</td><td className="p-3 text-center">{w.falseFlags}</td>
                <td className="p-3 text-right num">${w.overpaid.toLocaleString()} / ${w.underpaid.toLocaleString()}</td>
                <td className="p-3 text-xs">{w.topAmbiguity ? <>${w.topAmbiguity.dollarsAtStake.toLocaleString()} — <i>“{w.topAmbiguity.clause}”</i></> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Last run {new Date(r.ranAt).toUTCString()}.</p>
    </div>
  );
}
function Box({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-line bg-white p-4"><p className="text-xs text-muted">{label}</p><p className="text-2xl font-semibold mt-1">{value}</p></div>;
}
