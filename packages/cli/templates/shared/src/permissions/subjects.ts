export interface TaskSubject {
  id: string;
  title: string;
  completed: boolean;
  ownerId: number | (() => number);
  isLocked?: boolean | (() => boolean) | undefined;
}

