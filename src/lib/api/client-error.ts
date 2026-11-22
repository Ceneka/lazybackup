/**
 * Helpers for turning a failed `fetch` response into a message a form can show.
 *
 * LazyBackup API routes answer errors as `{ error, details? }`, where `details`
 * is either a Zod issues array (`[{ path, message }]`) or a `z.flattenError()`
 * shaped object (`{ formErrors, fieldErrors }`).
 */

export type ApiFieldErrors = Record<string, string>

export type ReadApiErrorResult = {
  /** Best human-readable message, including the first validation issue when useful. */
  message: string
  /** Per-field validation messages keyed by dotted path (e.g. `server.port`). */
  fieldErrors: ApiFieldErrors
}

/** Error type for callers that want to keep the parsed field errors around. */
export class ApiError extends Error {
  readonly status: number
  readonly fieldErrors: ApiFieldErrors

  constructor(
    message: string,
    options: { status?: number; fieldErrors?: ApiFieldErrors } = {}
  ) {
    super(message)
    this.name = "ApiError"
    this.status = options.status ?? 0
    this.fieldErrors = options.fieldErrors ?? {}
  }
}

type ValidationIssue = {
  field: string
  message: string
}

/**
 * Read `{ error, details }` from a failed response.
 *
 * Never throws: unreadable/non-JSON bodies fall back to `Request failed (status)`.
 */
export async function readApiError(res: Response): Promise<ReadApiErrorResult> {
  let errorText: string | undefined
  let details: unknown

  try {
    const body: unknown = await res.json()
    if (isRecord(body)) {
      errorText = firstString(body.error)
      details = body.details
    } else if (typeof body === "string") {
      errorText = firstString(body)
    }
  } catch {
    // Non-JSON response — fall through to the status-based message.
  }

  const issues = extractIssues(details)
  const fieldErrors: ApiFieldErrors = {}
  for (const issue of issues) {
    if (issue.field && !fieldErrors[issue.field]) {
      fieldErrors[issue.field] = issue.message
    }
  }

  const fallback = res.status
    ? `Request failed (${res.status})`
    : "Request failed"

  // Prefer the first concrete validation issue over a useless generic
  // "Validation error" while still preserving specific server messages.
  const primaryIssue = issues[0]
  const message =
    primaryIssue && (!errorText || isGenericValidationMessage(errorText))
      ? formatIssue(primaryIssue)
      : errorText ?? (primaryIssue ? formatIssue(primaryIssue) : fallback)

  return { message, fieldErrors }
}

function extractIssues(details: unknown): ValidationIssue[] {
  if (!details) return []

  if (typeof details === "string") {
    const message = firstString(details)
    return message ? [{ field: "", message }] : []
  }

  if (Array.isArray(details)) {
    return details.flatMap((entry) => {
      if (typeof entry === "string") {
        const message = firstString(entry)
        return message ? [{ field: "", message }] : []
      }
      const issue = extractIssue(entry)
      return issue ? [issue] : []
    })
  }

  if (!isRecord(details)) return []

  const issues: ValidationIssue[] = []

  // A serialized ZodError uses `issues`; a plain Zod path may also be nested.
  if (Array.isArray(details.issues)) {
    for (const entry of details.issues) {
      const issue = extractIssue(entry)
      if (issue) issues.push(issue)
    }
  }

  // `z.flattenError()` shape: fieldErrors: { field: ["message", ...] }
  const fieldErrors = details.fieldErrors
  if (isRecord(fieldErrors)) {
    for (const [field, value] of Object.entries(fieldErrors)) {
      const message = firstString(value)
      if (message) issues.push({ field, message })
    }
  }

  // `z.flattenError()` shape: formErrors: ["message", ...]
  if (Array.isArray(details.formErrors)) {
    for (const entry of details.formErrors) {
      const message = firstString(entry)
      if (message) issues.push({ field: "", message })
    }
  }

  return issues
}

function extractIssue(value: unknown): ValidationIssue | null {
  if (!isRecord(value)) return null
  const message = firstString(value.message)
  if (!message) return null
  return { field: pathToString(value.path), message }
}

function pathToString(path: unknown): string {
  if (!Array.isArray(path)) return ""
  return path
    .filter(
      (part): part is string | number =>
        typeof part === "string" || typeof part === "number"
    )
    .join(".")
}

function formatIssue(issue: ValidationIssue): string {
  return issue.field ? `${issue.field}: ${issue.message}` : issue.message
}

const GENERIC_VALIDATION_MESSAGE =
  /^(validation (error|failed)|invalid (input|request|body|data)|bad request)$/i

function isGenericValidationMessage(message: string): boolean {
  return GENERIC_VALIDATION_MESSAGE.test(message.trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = firstString(entry)
      if (text) return text
    }
  }
  return undefined
}
