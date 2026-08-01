import type { ModelRate } from "../lib/pricing";
import {
  CACHE_READ_FACTOR,
  CACHE_WRITE_FACTOR,
  DEFAULT_RATES,
} from "../lib/pricing";

// 概算コストの単価編集。値はこのブラウザのlocalStorageにだけ保存され、
// サマリーJSONやチーム共有には含まれない。
export function RatesEditor({
  rates,
  usedModels,
  onChange,
}: {
  rates: Record<string, ModelRate>;
  /** データに登場したモデル(既定表に無ければ行を足して編集できるようにする) */
  usedModels: string[];
  onChange: (rates: Record<string, ModelRate>) => void;
}) {
  const models = [
    ...Object.keys(rates),
    ...usedModels.filter(
      (m) => !Object.keys(rates).some((k) => m === k || m.startsWith(k)),
    ),
  ];
  const set = (model: string, field: keyof ModelRate, value: string) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return;
    const cur = rates[model] ?? { input: 0, output: 0 };
    onChange({ ...rates, [model]: { ...cur, [field]: n } });
  };
  const isDefault = Object.entries(DEFAULT_RATES).every(
    ([m, d]) =>
      rates[m] && rates[m].input === d.input && rates[m].output === d.output,
  );
  return (
    <details className="chart-table">
      <summary>単価を編集 (USD / 100万トークン)</summary>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>モデル</th>
              <th>入力 $/M</th>
              <th>出力 $/M</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model}>
                <td>{model}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={rates[model]?.input ?? ""}
                    placeholder="未設定"
                    onChange={(e) => set(model, "input", e.target.value)}
                    style={{ width: 80 }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={rates[model]?.output ?? ""}
                    placeholder="未設定"
                    onChange={(e) => set(model, "output", e.target.value)}
                    style={{ width: 80 }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="card-desc" style={{ marginTop: 8 }}>
        キャッシュ読取は入力単価の{CACHE_READ_FACTOR}倍、キャッシュ作成は
        {CACHE_WRITE_FACTOR}
        倍で自動計算します。単価はこのブラウザにのみ保存され、チームには共有されません。
      </p>
      {!isDefault && (
        <button className="ghost" onClick={() => onChange({ ...DEFAULT_RATES })}>
          既定の単価に戻す
        </button>
      )}
    </details>
  );
}
