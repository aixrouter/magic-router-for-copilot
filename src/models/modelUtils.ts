export function inferMaxContextWindow(modelText: string): number {
  if (
    /^claude-(haiku|sonnet|opus)-/.test(modelText) ||
    /^gemini-/.test(modelText) ||
    /^gpt-5(\b|[.-])/.test(modelText)
  ) {
    return 1000000;
  }
  return 200000;
}

export function getContextWindows(modelText: string, apiContextWindow: number | undefined): number[] {
  const maxWindow = Math.max(apiContextWindow ?? 0, inferMaxContextWindow(modelText));
  return [200000, 400000, 1000000].filter((value) => value <= maxWindow);
}

export function numberFrom(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}
