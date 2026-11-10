'use client'

import { Calendar, CornerDownRight, HelpCircle, Target, TrendingUp } from 'lucide-react'

// KPI進捗の数字がどう決まっているかの説明。
//
// 目標の引き継ぎ・繰り越し・アポ連動が重なって、
// 「昨日と同じ設定なのにノルマが違う」が起きるようになった。
// 画面のどこにも理由が書いていないと毎回聞かれるので、
// 数字を出している場所のすぐ横に置いておく。
//
// 色は実際の表示と合わせてある（琥珀＝繰り越しの残り・緑＝消化済み・紫＝アポ調整）。
// ノルマの計算を変えたら必ずここも直す。
// 説明の色だけ変えると、バーに出ている色と結びつかなくなる。

const CARD = 'rounded-xl border p-3'

export default function KpiHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null

  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <HelpCircle size={15} className="text-slate-500" />
          <p className="text-sm font-semibold text-slate-700">ノルマの決まり方</p>
        </div>
        <button
          onClick={onClose}
          className="text-xs font-medium text-slate-500 hover:text-slate-800 underline underline-offset-2 shrink-0"
        >
          閉じる
        </button>
      </div>

      <div className="space-y-3">
        <div className={`${CARD} border-slate-200 bg-white`}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Target size={13} className="text-rose-500" />
            <p className="text-xs font-semibold text-slate-700">1. 契約目標から逆算する</p>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            「目標設定」で入れるのは<span className="font-semibold">契約件数だけ</span>です。
            そこに商材ごとの<span className="font-semibold">1契約あたりのアポ数</span>と
            <span className="font-semibold">1アポあたりの送信数</span>を掛けて、
            必要なアポ数と送信数を出しています。
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            契約 3件 × アポ 12件 × 送信 30通 = 月に 1,080通
          </p>
        </div>

        <div className={`${CARD} border-slate-200 bg-white`}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Calendar size={13} className="text-blue-500" />
            <p className="text-xs font-semibold text-slate-700">2. 営業日で割る</p>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            月の目標を<span className="font-semibold">営業日数</span>で割ったものが1日ぶんです。
            土日と祝日は数えません（祝日は設定に登録したぶん）。
            月の途中から数え始めた商材は、その日を起点に按分します。
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            1,080通 ÷ 19営業日 = 1日 約57通
          </p>
        </div>

        <div className={`${CARD} border-slate-200 bg-white`}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <CornerDownRight size={13} className="text-amber-600" />
            <p className="text-xs font-semibold text-slate-700">
              3. <span className="text-amber-600">繰り越し</span>（前月の未消化ぶん）
            </p>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            前の月に送りきれなかったぶんは、翌月に繰り越します。
            <span className="font-semibold">毎日のノルマには混ぜず、別枠で数えます</span>（2026年10月から）。
            <span className="font-semibold">月末日のノルマのうち、アポ調整で増えたぶんを送り残した場合も繰り越しに入ります</span>
            （月間目標を送り切っていても残ります）。多く送った月はその超過分が貯金になって、
            次の繰り越しから差し引かれます。
          </p>
          <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
            送った分は<span className="font-semibold">まずその日のノルマに充てて、
            その日のノルマを超えて送ったぶんで繰り越しが減ります</span>。
            前の日に足りなかったぶんがあれば、先にそちらを埋めます。
            <span className="font-semibold">一度減った繰り越しは、あとで足りない日があっても戻りません。</span>
            土日や休業日に送ったぶんは、そのまま繰り越しを減らします。
          </p>
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            <li>・例：1日50通・繰り越し100通の月に80通送る → 今日のぶんは達成、繰り越しは残り70通</li>
            <li>・繰り越しが残っていても、今日のぶんを送り切っていれば警告バーは
              <span className="font-semibold text-amber-600">琥珀（本日分は達成・繰越あり）</span>になり、赤にはなりません
            </li>
            <li>・月末までに残った繰り越しは、また翌月に繰り越します</li>
            <li>・2026年9月までは、繰り越しは月の最初の営業日にまとめて乗り、今月ぶんを送り切ってから減る数え方でした</li>
          </ul>
          <p className="mt-1.5 text-xs text-slate-500">
            画面では<span className="font-semibold text-amber-600">「繰越 残り82通」</span>
            のように出て、送り切ると
            <span className="font-semibold text-emerald-600">「消化済み」</span>に変わります
          </p>
        </div>

        <div className={`${CARD} border-slate-200 bg-white`}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <TrendingUp size={13} className="text-violet-600" />
            <p className="text-xs font-semibold text-slate-700">
              4. <span className="text-violet-600">アポ調整</span>（2026年9月から）
            </p>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            アポの取れ具合で、その日の送信ノルマが増えます。
            <span className="font-semibold">残りのアポ数を残りの営業日で割り直す</span>ので、
            アポが遅れているほどノルマが上がり、取れているほど基準どおりに戻ります。
            <span className="font-semibold">基準の1日ぶんより下がることはありません。</span>
          </p>
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            <li>・その月に実施予定のアポは、まだ先の日付でも残アポから引きます</li>
            <li>・失注・契約済・禁止のステータスは数えません</li>
            <li>・
              <span className="font-semibold">ノルマは朝に確定して、その日は動きません。</span>
              今日入れたアポが効くのは翌朝からです
            </li>
            <li>・繰り越しぶんには倍率を掛けません（そのまま足すだけ）</li>
            <li>・月末日のアポ調整ぶんを送り残すと、翌月の繰り越しに入ります（月末日のノルマにはその時点で足りないアポの分が全部入っているため、ほかの日のぶんは足しません）</li>
          </ul>
          <p className="mt-1.5 text-xs text-slate-500">
            画面では<span className="font-semibold text-violet-600">「アポ調整 +63通」</span>のように出ます
          </p>
        </div>

        <div className={`${CARD} border-slate-200 bg-white`}>
          <p className="text-xs font-semibold text-slate-700 mb-1.5">そのほか</p>
          <ul className="space-y-1 text-xs text-slate-600 leading-relaxed">
            <li>
              ・目標を入れ直すまでは<span className="font-semibold">前の月の設定がそのまま効きます</span>。
              月が変わってもノルマが0にはなりません
            </li>
            <li>
              ・上の警告バーの「本日残り」は月初からの累計で見ています（繰り越しは含みません）。
              繰り越しを送り切ったあとに前倒しで送った日があれば、その先行分だけ翌日以降が軽くなります
            </li>
            <li>
              ・警告バーは 8時・12時・17時に出ます。8時はお知らせ、12時は注意、17時は警告です。
              今日のぶんを送り切れば緑、繰り越しだけ残っていれば琥珀になります
            </li>
            <li>
              ・日／週／月の切り替えのうち、アポ調整が効くのは
              <span className="font-semibold">「日」だけ</span>です。
              週と月は月の目標をそのまま出しています
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
