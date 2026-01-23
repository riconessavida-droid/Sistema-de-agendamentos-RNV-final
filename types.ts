export enum MeetingStatus {
  PENDING = 'PENDING',
  DONE = 'DONE',
  NOT_DONE = 'NOT_DONE',
  RESCHEDULED = 'RESCHEDULED',
  CLOSED_CONTRACT = 'CLOSED_CONTRACT'
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
  }>;
  groupColor: string;
}

export interface Reminder {
  clientId: string;
  clientName: string;
  meetingNumber: number;
  date: string;
  status: MeetingStatus;
}