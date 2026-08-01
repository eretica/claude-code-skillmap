import { expect, test } from "@playwright/test";

const ROOM = "e2eroom0123456789abcdef"; // mock-api.mjs の E2E_ROOM と一致させる

// ルーティング: ルートは個人解析のみ(共有・チーム機能なし)、フル機能はルームURLから
test("ルートは個人解析のみでアップロードできない", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("個人解析モード")).toBeVisible();
  await expect(page.locator(".dropzone")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "チーム集計" })).toHaveCount(0);
  // noindexメタが入っている
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
  // 解析はできるが、共有ボタンは存在せずエクスポートのみ
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles("e2e/fixtures/projects");
  await expect(page.locator(".stat-tile").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "チームに共有" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "サマリーJSONをエクスポート" }),
  ).toBeVisible();
});

test("管理画面でルームの発行・一覧ができる", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByText("ルーム一覧")).toBeVisible();
  await expect(page.locator(".admin-table tbody tr")).toHaveCount(1); // e2eルーム
  await page.getByPlaceholder(/ラベル/).fill("new-team");
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await expect(page.locator(".admin-table tbody tr")).toHaveCount(2);
  await expect(page.getByText("new-team")).toBeVisible();
});

// クラウド版の一連の流れ: サーバー読込 → 解析 → 除外 → 共有 → チーム反映 → 項目削除
test("解析から共有・チーム集計・項目削除までの一連の流れ", async ({
  page,
}) => {
  await page.goto(`/r/${ROOM}`);

  // 1. チーム集計: モックに事前投入された3名(e2e-userは古い日付の保存分のみ)が読み込まれる
  await page.getByRole("button", { name: "チーム集計" }).click();
  await expect(page.locator(".member-chip")).toHaveText([
    /demo-a/,
    /demo-b/,
    /e2e-user/,
  ]);

  // 2. 個人解析: fixtureをパースし、1項目除外して共有
  await page.getByRole("button", { name: "個人解析" }).click();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles("e2e/fixtures/projects");
  await expect(page.locator(".stat-tile").first()).toBeVisible();

  // stats-cacheバックフィル: トランスクリプトに無い過去日(2026-05-01)が取り込まれる
  await page
    .locator("input.backfill-input")
    .setInputFiles("e2e/fixtures/stats-cache.json");
  await expect(page.getByText(/2 日分のアクティビティをバックフィル/)).toBeVisible();
  await expect(
    page.locator(".stat-tile", { hasText: "セッション数" }).first(),
  ).toContainText("2026-05-01");

  await page.locator(".exclude-panel > summary").click();
  const excludeItem = page.locator(".exclude-item", {
    hasText: "demo-skill-b",
  });
  await excludeItem.locator("input").uncheck();

  await page
    .locator(".controls-row input[type=text]")
    .first()
    .fill("e2e-user");

  // 送信内容プレビュー: 除外した項目が実際に含まれていないことを現物で確認できる
  await page.getByRole("button", { name: "送信内容を確認" }).click();
  const preview = page.locator(".preview-json");
  await expect(preview).toContainText('"schemaVersion": 1');
  await expect(preview).toContainText("demo-skill-a");
  await expect(preview).not.toContainText("demo-skill-b");
  await page.getByRole("button", { name: "内容を閉じる" }).click();

  await page.getByRole("button", { name: "チームに共有" }).click();
  await expect(page.getByText("共有しました")).toBeVisible();

  // 3. チーム集計に反映され、除外した項目はe2e-userの列に現れない
  //    (行自体は他メンバーが使っていれば残る)
  await page.getByRole("button", { name: "チーム集計" }).click();
  await page.getByRole("button", { name: /再読み込み/ }).click();
  await expect(page.locator(".member-chip", { hasText: "e2e-user" })).toBeVisible();
  await expect(page.locator(".heatmap").first()).toBeVisible();
  const excludedRow = page.locator(".heatmap tbody tr", {
    hasText: "demo-skill-b",
  });
  await expect(excludedRow.locator("td").nth(2)).toHaveText("–");

  // 蓄積の検証: 再共有は日付マージなので、古い保存分(2026-06-01のlegacy-skill)が消えていない
  const legacyRow = page.locator(".heatmap tbody tr", {
    hasText: "legacy-skill",
  });
  await expect(legacyRow.locator("td").nth(2)).toHaveText("7");
  // 今回の解析分(demo-skill-a)も同時に入っている = 両期間が共存
  const freshRow = page.locator(".heatmap tbody tr", {
    hasText: "demo-skill-a",
  });
  await expect(freshRow.locator("td").nth(2)).not.toHaveText("–");

  // ヒートマップの絞り込み(全カテゴリ共通)とメンバー列ソート
  await page.locator(".hm-filter").fill("demo-skill-b");
  await expect(page.locator(".heatmap tbody tr")).toHaveCount(1);
  await page.locator(".hm-filter").fill("");
  const skillsCard = page.locator(".card", { hasText: "スキル × メンバー" });
  const sortHeader = skillsCard.locator("thead th.sortable", {
    hasText: "demo-b",
  });
  await sortHeader.click();
  await expect(sortHeader).toContainText("▼");
  await sortHeader.click();

  // 全カテゴリが同時に表示される(タブ切替なし)。データのないカテゴリは出ない
  await expect(
    page.locator(".card", { hasText: "サブエージェント × メンバー" }),
  ).toBeVisible();
  await expect(
    page.locator(".card", { hasText: "MCPツール × メンバー" }),
  ).toHaveCount(0);

  // 4. 削除モードでのみセル削除できる(通常時はクリック無効)
  const row = page.locator(".heatmap tbody tr", { hasText: "demo-skill-a" });
  const cellOfE2eUser = row.locator("td").nth(2); // demo-a, demo-b, e2e-user の順
  await expect(cellOfE2eUser).not.toHaveText("–");
  await cellOfE2eUser.click(); // 削除モード外なので何も起きない
  await expect(cellOfE2eUser).not.toHaveText("–");

  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "項目を削除する…" }).click();
  await cellOfE2eUser.click();
  await expect(cellOfE2eUser).toHaveText("–");

  // 5. 期間フィルタの切替でタイルが変わる(全期間→直近7日)
  // fixtureの日付は2026-07-28固定のため、テスト実行日によっては期間外になる。
  // ここではUIが切り替わること(エラーなく再計算されること)だけを確認する。
  await page.getByRole("button", { name: "直近7日" }).click();
  await expect(
    page.locator(".stat-tile", { hasText: "合計セッション" }),
  ).toBeVisible();

  // 6. 個人 vs チーム比較カード: 対象切替と1対1比較(基準をメンバーに変更)
  await page.getByRole("button", { name: "全期間" }).click();
  const compare = page.locator(".card", { hasText: "個人 vs チーム" });
  await compare.locator("select").first().selectOption("e2e-user");
  await expect(compare.getByText(/位\/3人/).first()).toBeVisible();
  await compare.locator("select").nth(1).selectOption("demo-b");
  await expect(compare.getByText(/demo-b \d/).first()).toBeVisible();

  // 7. おすすめカード: e2e-userが未使用でチームが使っている機能が提案される
  const rec = page.locator(".card", { hasText: "e2e-user へのおすすめ" });
  await expect(rec.locator(".rec-row").first()).toBeVisible();

  // 8. この人に聞こうカード: スキルを選ぶとトップユーザーが出る
  const ask = page.locator(".card", { hasText: "この人に聞こう" });
  await ask.locator("select").nth(1).selectOption("demo-skill-b");
  await expect(ask.getByText(/まず聞くなら/)).toBeVisible();

  // 9. URLハッシュに表示状態が載る
  await page.getByRole("button", { name: "直近30日" }).click();
  await expect
    .poll(async () => page.evaluate(() => window.location.hash))
    .toContain("period=30");
  await expect
    .poll(async () => page.evaluate(() => window.location.hash))
    .toContain("target=e2e-user");
});
