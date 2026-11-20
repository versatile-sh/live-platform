import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { renderWithApp } from "../test-support/render";
import { PrivacyPage } from "./PrivacyPage";

describe("PrivacyPage", () => {
  test("says what is logged, why, for how long, who can read it and that private chat is never logged", () => {
    renderWithApp(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy and access logs" })).toBeInTheDocument();
    expect(screen.getByText(/Marco Civil da Internet/)).toBeInTheDocument();
    expect(screen.getByText(/Six months/)).toBeInTheDocument();
    expect(screen.getByText(/Only the operators of the server/)).toBeInTheDocument();
    expect(screen.getByText(/content of a private room is never logged/)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(7);
  });
});
