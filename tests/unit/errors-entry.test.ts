import { Exception } from "@c9up/flare";
import { describe, expect, it } from "vitest";
import { errors } from "../../src/index.js";

describe("the errors namespace", () => {
	it("is exported from the entry, one flare Exception per code", () => {
		const error = new errors.E_LUMEN_INVALID_COLUMN(["no such column"]);
		expect(error).toBeInstanceOf(Exception);
		expect(error).toBeInstanceOf(errors.E_LUMEN_INVALID_COLUMN);
		expect(error.code).toBe("E_LUMEN_INVALID_COLUMN");
		expect(error.status).toBe(500);
		expect(error.message).toBe("no such column");
		expect(new errors.E_LUMEN_TASK_NO_RESULT().message).toBe(
			"the task returned no result: return a success message, or an Error",
		);
	});
});
