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
  contractValue?: number;   // valor líquido fixado na época do contrato (após taxa)
  contractGrossValue?: number; // valor bruto fixado na época do contrato
  contractMachineRate?: number; // taxa fixada na época do contrato
}

export interface Reminder {
  clientId: string;
  clientName: string;
  meetingNumber: number;
  date: string;
  status: MeetingStatus;
}

export interface BillingConfig {
  contractValue: number;
  machineRate: number;
}

export interface ClientBilling {
  clientId: string;
  clientName: string;
  billingValue: number;
  paymentStatus: 'PENDING' | 'PAID';
  paymentDate: string;
  amount: number;
  isProportional?: boolean;
}

export interface BillingPeriod {
  id: number;
  fromMonth: string;
  toMonth: string | null;
  grossValue: number;
  machineRate: number;
  netValue: number;
}
