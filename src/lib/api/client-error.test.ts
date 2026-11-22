import { describe, expect, test } from "bun:test"

import { ApiError, readApiError } from "./client-error"

function jsonResponse(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("readApiError", () => {
  test("prefers the first Zod issue over a bare Validation error", async () => {
    const result = await readApiError(
      jsonResponse({
        error: "Validation error",
        details: [
          { path: ["name"], message: "Required", code: "too_small" },
          { path: ["host"], message: "Invalid host" },
        ],
      })
    )

    expect(result.message).toBe("name: Required")
    expect(result.fieldErrors).toEqual({
      name: "Required",
      host: "Invalid host",
    })
  })

  test("prefixes nested field paths", async () => {
    const result = await readApiError(
      jsonResponse({
        error: "Validation error",
        details: [{ path: ["server", "port"], message: "Expected number" }],
      })
    )

    expect(result.message).toBe("server.port: Expected number")
    expect(result.fieldErrors).toEqual({ "server.port": "Expected number" })
  })

  test("keeps a specific server error message", async () => {
    const result = await readApiError(
      jsonResponse({
        error: "Name already in use",
        details: [{ path: ["name"], message: "Required" }],
      })
    )

    expect(result.message).toBe("Name already in use")
    expect(result.fieldErrors).toEqual({ name: "Required" })
  })

  test("reads the z.flattenError shape", async () => {
    const result = await readApiError(
      jsonResponse({
        error: "Validation error",
        details: {
          formErrors: [],
          fieldErrors: { url: ["Invalid URL"], name: ["Required"] },
        },
      })
    )

    expect(result.message).toBe("url: Invalid URL")
    expect(result.fieldErrors).toEqual({
      url: "Invalid URL",
      name: "Required",
    })
  })

  test("uses a form-level issue when there is no field path", async () => {
    const result = await readApiError(
      jsonResponse({
        error: "Validation error",
        details: { formErrors: ["Passwords do not match"], fieldErrors: {} },
      })
    )

    expect(result.message).toBe("Passwords do not match")
    expect(result.fieldErrors).toEqual({})
  })

  test("falls back to the status for a non-JSON body", async () => {
    const result = await readApiError(
      new Response("<html>bad gateway</html>", { status: 502 })
    )

    expect(result.message).toBe("Request failed (502)")
    expect(result.fieldErrors).toEqual({})
  })

  test("falls back to the HTTP status when no error text exists", async () => {
    const result = await readApiError(jsonResponse({}, 500))
    expect(result.message).toBe("Request failed (500)")
  })

  test("handles a details string", async () => {
    const result = await readApiError(
      jsonResponse({ details: "Disk is full" }, 500)
    )
    expect(result.message).toBe("Disk is full")
  })
})

describe("ApiError", () => {
  test("carries status and field errors", () => {
    const error = new ApiError("name: Required", {
      status: 422,
      fieldErrors: { name: "Required" },
    })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("ApiError")
    expect(error.message).toBe("name: Required")
    expect(error.status).toBe(422)
    expect(error.fieldErrors).toEqual({ name: "Required" })
  })

  test("defaults to empty field errors", () => {
    const error = new ApiError("Failed")
    expect(error.status).toBe(0)
    expect(error.fieldErrors).toEqual({})
  })
})
