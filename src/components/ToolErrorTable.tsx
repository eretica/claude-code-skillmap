// ツール失敗率: tool_resultのis_error回数を呼び出し回数と突き合わせた表。
// エラー本文は一切保持していない(回数のみ)。
export function ToolErrorTable({
  toolErrors,
  toolCalls,
}: {
  toolErrors: Record<string, number>;
  /** ツール名 -> 呼び出し回数(組み込み+MCPを結合したもの) */
  toolCalls: Record<string, number>;
}) {
  const rows = Object.entries(toolErrors)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, errors]) => {
      const calls = toolCalls[name] ?? 0;
      return {
        name,
        errors,
        calls,
        rate: calls > 0 ? Math.round((errors / calls) * 100) : null,
      };
    });
  if (rows.length === 0)
    return <div className="empty-note">記録されたツールエラーはありません</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="mini-table">
        <thead>
          <tr>
            <th>ツール</th>
            <th>失敗</th>
            <th>呼び出し</th>
            <th>失敗率</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{r.errors.toLocaleString()}</td>
              <td>{r.calls.toLocaleString()}</td>
              <td>{r.rate === null ? "–" : `${r.rate}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
