'use client'

import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ArrowLeft } from 'lucide-react'
import CompanyForm from '@/components/CompanyForm'

export default function NewCompanyPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const isStaff = session?.user?.role === 'staff'

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push(isStaff ? '/staff' : '/')}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-700 transition"
        >
          <ArrowLeft size={15} />戻る
        </button>
        <h1 className="text-xl font-bold text-slate-800">新規顧客登録</h1>
      </div>
      <CompanyForm
        onSuccess={(id) => router.push(isStaff ? '/staff' : `/companies/${id}`)}
      />
    </div>
  )
}
