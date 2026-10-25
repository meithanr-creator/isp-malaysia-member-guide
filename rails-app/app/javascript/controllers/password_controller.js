import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["input", "button"]

  connect() {
    if (this.inputTarget.id) this.buttonTarget.setAttribute("aria-controls", this.inputTarget.id)
    this.update()
  }

  toggle() {
    this.inputTarget.type = this.inputTarget.type === "password" ? "text" : "password"
    this.update()
  }

  update() {
    const visible = this.inputTarget.type === "text"
    this.buttonTarget.textContent = visible ? "Hide" : "Show"
    this.buttonTarget.setAttribute("aria-label", visible ? "Hide password" : "Show password")
    this.buttonTarget.setAttribute("aria-pressed", String(visible))
  }
}