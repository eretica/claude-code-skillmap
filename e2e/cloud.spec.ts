import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const ROOM = "e2eroom0123456789abcdef"; // mock-api.ts の E2E_ROOM と一致させる

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
  await expect(page.getByRole("button", { name: "チームに共有…" })).toHaveCount(
    0,
  );

  // 過去履歴(stats-cache.json)は単体ファイルのD&Dでも取り込める
  const statsJson = readFileSync("e2e/fixtures/stats-cache.json", "utf8");
  const dataTransfer = await page.evaluateHandle((json) => {
    const dt = new DataTransfer();
    dt.items.add(
      new File([json], "stats-cache.json", { type: "application/json" }),
    );
    return dt;
  }, statsJson);
  await page.dispatchEvent(".dropzone", "drop", { dataTransfer });
  await expect(
    page.getByText(/2 日分のアクティビティをバックフィル/),
  ).toBeVisible();
  // エクスポートはモーダル経由。開くと共有ボタンはなくエクスポートのみ
  await page
    .getByRole("button", { name: "サマリーJSONをエクスポート…" })
    .click();
  const modal = page.locator(".modal");
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("button", { name: /として共有する/ })).toHaveCount(
    0,
  );
  await expect(
    modal.getByRole("button", { name: "JSONをエクスポート" }),
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

  // 新指標(個人): 委任度タイル・ツール失敗率・概算コスト
  await expect(page.locator(".stat-tile", { hasText: "委任度" })).toContainText(
    "38%", // サイドチェーン3(本体1+サブエージェント2) / アシスタント8件
  );
  await expect(
    page
      .locator(".card", { hasText: "ツール失敗率" })
      .locator("tbody tr", { hasText: "Bash" }),
  ).toContainText("100%");
  await expect(
    page.locator(".card h2").filter({ hasText: /^概算コスト/ }),
  ).toBeVisible();

  // セッション詳細: 一覧からタイムラインを開く(OTel風・ローカル閲覧のみ)
  const sessionCard = page.locator(".card", { hasText: "セッション詳細" });
  await expect(
    sessionCard.locator("tbody tr", { hasText: "E2Eデモセッション" }),
  ).toBeVisible();
  await sessionCard.locator("tbody tr").first().click();
  const tl = page.locator(".modal");
  await expect(tl).toBeVisible();
  // スキル帰属スパン + サブエージェントスパン(サブエージェント自身の実時間で描画)
  await expect(
    tl.locator(".tl-row", { hasText: "demo-skill-a" }).first(),
  ).toBeVisible();
  const agentRow = tl.locator(".tl-row", { hasText: "explore" }).first();
  await expect(agentRow).toContainText("msg");
  await tl.locator(".modal-close").click();
  await expect(page.locator(".modal")).toHaveCount(0);

  // サブエージェント呼び出し一覧: 種別照合・prompt長(文字数)
  const subCard = page.locator(".card", { hasText: "サブエージェント呼び出し" });
  const subRow = subCard.locator("tbody tr").first();
  await expect(subRow).toContainText("Explore · explore");
  await expect(subRow).toContainText("haiku-4-5");
  await expect(subRow).toContainText(String("explore the demo repo".length));
  // 「詳細」=エージェント単体のミニタイムライン
  await subRow.getByRole("button", { name: /見る/ }).click();
  await expect(page.locator(".modal", { hasText: "エージェント本体" })).toBeVisible();
  await page.locator(".modal .modal-close").click();
  // 「開く」=親セッションのタイムライン(ツール失敗マーカー付き)
  await subRow.getByRole("button", { name: /開く/ }).click();
  await expect(page.locator(".modal .tl-row").first()).toBeVisible();
  await expect(
    page.locator('.modal .tl-marker[title*="Bash 失敗"]'),
  ).toBeVisible();
  // 重かったターン表は表示されない(fixtureはプロンプト0〜1件のため)
  await page.locator(".modal .modal-close").click();
  await expect(page.locator(".modal")).toHaveCount(0);

  // stats-cacheバックフィル: トランスクリプトに無い過去日(2026-05-01)が取り込まれる
  await page
    .locator("input.backfill-input")
    .setInputFiles("e2e/fixtures/stats-cache.json");
  await expect(page.getByText(/2 日分のアクティビティをバックフィル/)).toBeVisible();
  await expect(
    page.locator(".stat-tile", { hasText: "セッション数" }).first(),
  ).toContainText("2026-05-01");

  // 共有はモーダルで完結: 表示名入力・除外・リポジトリ選択・確認・共有
  await page.getByRole("button", { name: "チームに共有…" }).click();
  const modal = page.locator(".modal");
  await expect(modal).toBeVisible();

  await modal.locator(".modal-field input").fill("e2e-user");

  // スキルの除外(モーダル内・常に展開されている)
  await modal
    .locator(".exclude-item", { hasText: "demo-skill-b" })
    .locator("input")
    .uncheck();

  // リポジトリ未選択なら確定ボタンが無効
  await expect(
    modal.getByRole("button", { name: "リポジトリを選んでください" }),
  ).toBeDisabled();

  // demo-repo(fixtureのcwd末尾)を選択
  await modal
    .locator(".repo-select .exclude-item", { hasText: "demo-repo" })
    .locator("input")
    .check();

  // 送信JSONの現物で、除外項目が含まれずリポジトリが入っていることを確認
  await modal.getByRole("button", { name: /出力されるJSONを見る/ }).click();
  const preview = modal.locator(".preview-json");
  await expect(preview).toContainText("demo-skill-a");
  await expect(preview).not.toContainText("demo-skill-b");
  await expect(preview).toContainText("demo-repo");

  await modal.getByRole("button", { name: /として共有する/ }).click();
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
  await expect(
    page.locator(".card", { hasText: "リポジトリ × メンバー" }),
  ).toBeVisible();

  // 新指標(チーム): 委任度ランキング・概算コスト・モデル×メンバー
  await expect(
    page.locator(".card", { hasText: "委任度" }).locator(".bl-label"),
  ).toHaveCount(3); // demo-a / demo-b / e2e-user(共有済み分)
  await expect(
    page.locator(".card", { hasText: "メンバー別 概算コスト" }),
  ).toBeVisible();
  await expect(
    page.locator(".card", { hasText: "モデル × メンバー" }),
  ).toBeVisible();

  // リポジトリフィルタ: 選ぶと全指標がそのリポジトリ内に絞られる
  const before = await page
    .locator(".stat-tile", { hasText: "合計セッション" })
    .textContent();
  await page
    .locator("select", { hasText: "全リポジトリ" })
    .selectOption("repo-alpha");
  await expect
    .poll(async () => page.evaluate(() => window.location.hash))
    .toContain("repo=repo-alpha");
  const after = await page
    .locator(".stat-tile", { hasText: "合計セッション" })
    .textContent();
  expect(after).not.toBe(before);
  // 絞り込み中はリポジトリ×メンバーのカードは出ない(自明なので)
  await expect(
    page.locator(".card", { hasText: "リポジトリ × メンバー" }),
  ).toHaveCount(0);
  await page.locator("select").first().selectOption("");

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

  // 4.5 任意期間(from〜to)指定: 6月に絞るとlegacy分(2026-06-01)だけになる
  await page.getByRole("button", { name: "期間指定" }).click();
  await page.locator(".period-range input").first().fill("2026-06-01");
  await page.locator(".period-range input").nth(1).fill("2026-06-30");
  await expect
    .poll(async () => page.evaluate(() => window.location.hash))
    .toContain("from=2026-06-01");
  await expect(
    page.locator(".stat-tile", { hasText: "合計セッション" }),
  ).toContainText("9"); // e2e-userの6月保存分のみ

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
