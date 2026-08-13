export interface RuntimePolicyViolation {
  label: string;
  text: string;
  index: number;
}

export function runtimePolicyViolations(text: string): RuntimePolicyViolation[];
export function verifyRuntimePolicy(directory?: string): Promise<void>;
