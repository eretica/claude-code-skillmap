// タイトル横の「?」アイコン。ホバー/フォーカスで説明を表示する。
// キーボードでも読めるよう tabIndex を持たせ、aria-label にも説明を入れる。
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="info-tip" tabIndex={0} aria-label={text}>
      ?
      <span className="info-tip-body" role="tooltip">
        {text}
      </span>
    </span>
  );
}
