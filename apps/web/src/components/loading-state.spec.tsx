import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { LoadingState } from "./loading-state";

describe("LoadingState", () => {
  it("renders the supplied loading title", () => {
    render(<LoadingState title="Đang tải danh sách lô" />);

    expect(
      screen.getByRole("heading", { name: "Đang tải danh sách lô" }),
    ).toBeInTheDocument();
  });
});
