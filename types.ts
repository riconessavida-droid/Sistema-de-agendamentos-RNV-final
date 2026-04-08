export enum MeetingStatus {
  PENDING = 'PENDING',
  DONE = 'DONE',
  NOT_DONE = 'NOT_DONE',
  RESCHEDULED = 'RESCHEDULED',
  CLOSED_CONTRACT = 'CLOSED_CONTRACT',
  CANCELLED_EARLY = 'CANCELLED_EARLY'
}

export enum UserRole {
  ADMIN = 'ADMIN',
  ASSISTANT = 'ASSISTANT'
}

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
  active?: boolean;
}

export interface Client {
  id: string;
  name: string;
  phoneDigits: string;
  startMonthYear: string;
  startDate: number;
  sequenceInMonth: number;
  statusByMonth: Record<string, {
    status: MeetingStatus;
    customDate?: number;
    notified?: boolean;
  }>;
  groupColor: string;
  extraMeetings: number;
  closedAt?: string;
  contractSigned?: boolean;
}

export interface Reminder {
  clientId: string;
  clientName: string;
  meetingNumber: number;
  date: string;
  status: MeetingStatus;
}

// ✅ NOVO — Faturamento
export interface BillingConfig {
  contractValue: number;  // Valor base do contrato (ex: 1599)
  machineRate: number;    // Taxa em % (ex: 10)
}

export interface ClientBilling {
  clientId: string;
  clientName: string;
  billingValue: number;   // Valor que recebe = contractValue - (contractValue * machineRate%)
  paymentStatus: 'PENDING' | 'PAID';  // Status do pagamento
  paymentDate: string;    // Data projetada de pagamento (YYYY-MM-DD)
  amount: number;         // Valor a receber (inteiro ou proporcional)
  isProportional?: boolean;  // Se foi encerrado antecipadamente
}

export interface Client {
  // ... campos existentes ...
  closedAt?: string;
  contractSigned?: boolean;
  
  // ✅ NOVO — guardar valor do contrato na data de início
  contractValue?: number;  // Valor que o cliente vai pagar (fixado na data de início)
}
