import { fireEvent, render, screen } from "@testing-library/react-native";

import { ThemeProvider } from "../theme/ThemeProvider";
import { Button } from "./Button";
import { ProofSeal } from "./ProofSeal";
import { StateBadge } from "./StateBadge";

function wrap(node: React.ReactElement) {
  return render(<ThemeProvider initialMode="light">{node}</ThemeProvider>);
}

describe("components", () => {
  it("explains what a verified proof means", async () => {
    await wrap(<ProofSeal status="VERIFIED" meta="tx 3f9a…c21e" />);
    expect(screen.getByText("Đã khớp bằng chứng")).toBeTruthy();
    expect(screen.getByText("Dữ liệu trùng khớp với bằng chứng đã neo trên blockchain.")).toBeTruthy();
    expect(screen.getByText("tx 3f9a…c21e")).toBeTruthy();
  });

  it("names a mismatch instead of hiding it", async () => {
    await wrap(<ProofSeal status="INTEGRITY_WARNING" compact />);
    expect(screen.getByText("Dữ liệu không khớp")).toBeTruthy();
  });

  it("labels lot state with words, not color alone", async () => {
    await wrap(<StateBadge state="RECALLED" />);
    expect(screen.getByLabelText("Trạng thái: Đã thu hồi")).toBeTruthy();
  });

  it("locks the button while a command is in flight", async () => {
    const onPress = jest.fn();
    await wrap(
      <Button onPress={onPress} loading>
        Ký và bàn giao 860 kg
      </Button>,
    );
    fireEvent.press(screen.getByRole("button"));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole("button").props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  });
});
