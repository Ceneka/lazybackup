import { formatCronExpression } from './format'

/** Common schedules for the backup form chips. */
export const CRON_PRESET_EXPRESSIONS = [
  '0 * * * *',
  '0 2 * * *',
  '0 2 * * 0',
] as const

export type CronPreset = {
  expression: string
  label: string
}

export function cronPresets(): CronPreset[] {
  return CRON_PRESET_EXPRESSIONS.map((expression) => ({
    expression,
    label: formatCronExpression(expression),
  }))
}
