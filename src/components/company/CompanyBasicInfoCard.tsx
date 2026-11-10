'use client'

import { CompanyFormValues } from '@/lib/companyForm'
import { INPUT_CLASS } from '@/lib/formStyles'
import ContractRevenueFields from './ContractRevenueFields'

// 顧客詳細ページの左カラム（基本情報＋契約情報）

type Option = { id: string; name: string }

type Props = {
  form: CompanyFormValues
  onChange: (patch: Partial<CompanyFormValues>) => void
  salesReps: Option[]
  genres: Option[]
  proposalProducts: Option[]
  selectedProductIds: string[]
  onProductsChange: (ids: string[]) => void
  isContracted: boolean
}

export default function CompanyBasicInfoCard({
  form, onChange, salesReps, genres, proposalProducts,
  selectedProductIds, onProductsChange, isContracted,
}: Props) {
  return (
    <div className="premium-card rounded-2xl p-5 space-y-3">
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">基本情報</h2>

      <div>
        <label className="block text-xs text-slate-400 mb-1">会社名 <span className="text-red-500">*</span></label>
        <input type="text" value={form.name} onChange={e => onChange({ name: e.target.value })} className={INPUT_CLASS} />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">代表者名</label>
        <input type="text" value={form.representative_name} onChange={e => onChange({ representative_name: e.target.value })} className={INPUT_CLASS} />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">サービス名</label>
        <input type="text" value={form.service_name} onChange={e => onChange({ service_name: e.target.value })} className={INPUT_CLASS} />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">ジャンル</label>
        <input type="text" list="genre-list" value={form.genre} onChange={e => onChange({ genre: e.target.value })} className={INPUT_CLASS} />
        <datalist id="genre-list">
          {genres.map(g => <option key={g.id} value={g.name} />)}
        </datalist>
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">住所</label>
        <input type="text" value={form.address} onChange={e => onChange({ address: e.target.value })} className={INPUT_CLASS} />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">営業担当</label>
        <select value={form.sales_rep_id} onChange={e => onChange({ sales_rep_id: e.target.value })} className={INPUT_CLASS}>
          <option value="">未設定</option>
          {salesReps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      {proposalProducts.length > 0 && (
        <div>
          <label className="block text-xs text-slate-400 mb-2">提案商材</label>
          <div className="flex flex-wrap gap-1.5">
            {proposalProducts.map(p => {
              const checked = selectedProductIds.includes(p.id)
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs cursor-pointer transition select-none ${
                    checked ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={checked}
                    onChange={() => onProductsChange(
                      checked ? selectedProductIds.filter(pid => pid !== p.id) : [...selectedProductIds, p.id]
                    )}
                  />
                  {checked && <span className="text-indigo-500">✓</span>}
                  {p.name}
                </label>
              )
            })}
          </div>
        </div>
      )}

      {isContracted && (
        <div className="border-t border-slate-100 pt-3">
          <ContractRevenueFields compact values={form} onChange={onChange} />
        </div>
      )}
    </div>
  )
}
