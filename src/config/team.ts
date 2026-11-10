// チーム構成はここ1か所で管理する（担当者の並び順・表示名・権限を持つ人）。
// 人の入れ替えがあっても、このファイルだけ直せば画面全体に反映される。

export type TeamMember = { email: string; name: string }

export const TEAM_MEMBERS: TeamMember[] = [
  { email: 'yamada@example.com', name: '山田 太郎' },
  { email: 'suzuki@example.com', name: '鈴木 一郎' },
]

// 目標の編集・売上ボードの管理操作・先行公開機能の対象になる責任者
export const OWNER_EMAIL = TEAM_MEMBERS[0].email

// 一覧やグラフで担当者を並べる順番
export const ACCOUNT_ORDER: string[] = TEAM_MEMBERS.map(m => m.email)

// 業務委託スタッフが登録した顧客を交互に割り当てる営業担当
export const ROTATION_REP_NAMES: string[] = TEAM_MEMBERS.map(m => m.name)
