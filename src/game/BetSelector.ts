import { Container, Graphics, Text } from "pixi.js";

export const BET_LIST = [1.0, 2.0, 5.0, 10.0] as const;

type BetListener = (bet: number) => void;

const ARROW_SIZE = 56;
const LABEL_W = 160;
const HEIGHT = 56;

export class BetSelector {
  readonly view: Container;
  private index = 0;
  private enabled = true;
  private listeners: BetListener[] = [];
  private label: Text;
  private leftBtn: Container;
  private rightBtn: Container;
  private leftBg: Graphics;
  private rightBg: Graphics;

  constructor() {
    this.view = new Container();

    this.leftBtn = new Container();
    this.leftBg = new Graphics();
    this.drawArrowBg(this.leftBg, true);
    this.leftBtn.addChild(this.leftBg);
    const leftArrow = new Text({
      text: "\u25C0",
      style: { fill: 0xffffff, fontSize: 28, fontWeight: "bold" },
    });
    leftArrow.anchor.set(0.5);
    leftArrow.x = ARROW_SIZE / 2;
    leftArrow.y = HEIGHT / 2;
    this.leftBtn.addChild(leftArrow);
    this.leftBtn.eventMode = "static";
    this.leftBtn.cursor = "pointer";
    this.leftBtn.on("pointertap", () => this.prev());
    this.view.addChild(this.leftBtn);

    const labelBg = new Graphics();
    labelBg.roundRect(ARROW_SIZE + 8, 0, LABEL_W, HEIGHT, 8);
    labelBg.fill({ color: 0x0f0f1a });
    this.view.addChild(labelBg);

    this.label = new Text({
      text: this.formatBet(this.bet),
      style: { fill: 0xffffff, fontSize: 28, fontWeight: "bold" },
    });
    this.label.anchor.set(0.5);
    this.label.x = ARROW_SIZE + 8 + LABEL_W / 2;
    this.label.y = HEIGHT / 2;
    this.view.addChild(this.label);

    this.rightBtn = new Container();
    this.rightBtn.x = ARROW_SIZE + 8 + LABEL_W + 8;
    this.rightBg = new Graphics();
    this.drawArrowBg(this.rightBg, true);
    this.rightBtn.addChild(this.rightBg);
    const rightArrow = new Text({
      text: "\u25B6",
      style: { fill: 0xffffff, fontSize: 28, fontWeight: "bold" },
    });
    rightArrow.anchor.set(0.5);
    rightArrow.x = ARROW_SIZE / 2;
    rightArrow.y = HEIGHT / 2;
    this.rightBtn.addChild(rightArrow);
    this.rightBtn.eventMode = "static";
    this.rightBtn.cursor = "pointer";
    this.rightBtn.on("pointertap", () => this.next());
    this.view.addChild(this.rightBtn);

    this.refreshVisuals();
  }

  get bet(): number {
    return BET_LIST[this.index];
  }
  next(): void {
    this.moveTo(this.index + 1);
  }
  prev(): void {
    this.moveTo(this.index - 1);
  }
  onBetChanged(fn: BetListener): void {
    this.listeners.push(fn);
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.refreshVisuals();
  }
  isEnabled(): boolean {
    return this.enabled;
  }

  private moveTo(nextIndex: number): void {
    if (!this.enabled) return;
    if (nextIndex < 0 || nextIndex >= BET_LIST.length) return;
    if (nextIndex === this.index) return;
    this.index = nextIndex;
    this.label.text = this.formatBet(this.bet);
    this.refreshVisuals();
    const v = this.bet;
    for (const fn of this.listeners) fn(v);
  }

  private refreshVisuals(): void {
    const leftActive = this.enabled && this.index > 0;
    const rightActive = this.enabled && this.index < BET_LIST.length - 1;
    this.drawArrowBg(this.leftBg, leftActive);
    this.drawArrowBg(this.rightBg, rightActive);
    this.leftBtn.eventMode = leftActive ? "static" : "none";
    this.rightBtn.eventMode = rightActive ? "static" : "none";
    this.leftBtn.cursor = leftActive ? "pointer" : "default";
    this.rightBtn.cursor = rightActive ? "pointer" : "default";
    this.label.alpha = this.enabled ? 1 : 0.5;
  }

  private drawArrowBg(g: Graphics, active: boolean): void {
    g.clear();
    g.roundRect(0, 0, ARROW_SIZE, HEIGHT, 8);
    g.fill({ color: active ? 0x3498db : 0x4a4a5e });
  }

  private formatBet(v: number): string {
    return v.toFixed(2);
  }
}
