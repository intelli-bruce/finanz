// 재무 데이터 타입 정의

// 프로필 정보 (직업, 업력 등)
export interface Profile {
  name: string;
  occupation: string; // 직종
  businessType?: string; // 사업 유형 (개인사업자, 법인 등)
  startDate: string; // 시작일 (업력 계산용)
  taxType: string; // 과세 유형 (간이과세, 일반과세 등)
  businessNumber?: string; // 사업자등록번호
  notes?: string;
}

// 수입 항목
export interface Income {
  id: string;
  date: string;
  category: string; // 급여, 사업소득, 기타소득 등
  amount: number;
  source: string; // 출처
  description?: string;
  taxDeductible?: boolean; // 세금 공제 가능 여부
  tags?: string[];
}

// 지출 항목
export interface Expense {
  id: string;
  date: string;
  category: string; // 운영비, 인건비, 재료비, 개인지출 등
  amount: number;
  vendor: string; // 지출처
  description?: string;
  deductible?: boolean; // 비용 처리 가능 여부
  receiptUrl?: string; // 영수증 링크
  tags?: string[];
}

// 자산
export interface Asset {
  id: string;
  name: string;
  type: string; // 현금, 예금, 주식, 부동산, 장비 등
  value: number;
  purchaseDate?: string;
  description?: string;
  tags?: string[];
}

// 부채
export interface Liability {
  id: string;
  name: string;
  type: string; // 대출, 카드, 외상 등
  amount: number;
  interestRate?: number;
  dueDate?: string;
  creditor: string; // 채권자
  description?: string;
  tags?: string[];
}

// 세금 정보
export interface Tax {
  id: string;
  year: number;
  quarter?: number; // 분기 (부가세 등)
  type: string; // 종합소득세, 부가가치세 등
  amount?: number;
  paid?: boolean;
  dueDate: string;
  deductions?: TaxDeduction[];
  notes?: string;
}

// 세금 공제 항목
export interface TaxDeduction {
  category: string;
  amount: number;
  description: string;
}

// 재무 목표
export interface FinancialGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline?: string;
  priority: 'high' | 'medium' | 'low';
  status: 'in-progress' | 'completed' | 'cancelled';
  notes?: string;
}

// 비즈니스 메트릭
export interface BusinessMetrics {
  period: string; // YYYY-MM 형태
  revenue: number; // 매출
  expenses: number; // 비용
  profit: number; // 순이익
  notes?: string;
}

// 전체 재무 데이터
export interface FinancialData {
  profile: Profile;
  incomes: Income[];
  expenses: Expense[];
  assets: Asset[];
  liabilities: Liability[];
  taxes: Tax[];
  goals: FinancialGoal[];
  businessMetrics: BusinessMetrics[];
  metadata: {
    lastUpdated: string;
    version: string;
  };
}
