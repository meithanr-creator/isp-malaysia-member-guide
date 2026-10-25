import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["token", "status", "submit"]

  connect() {
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const token = fragment.get("token") || this.tokenTarget.value
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname)
    if (/^[0-9a-f]{64}$/.test(token)) {
      this.tokenTarget.value = token
      this.submitTarget.disabled = false
      this.statusTarget.textContent = "Your private link is ready. Enter and confirm your password."
    } else {
      this.tokenTarget.value = ""
      this.submitTarget.disabled = true
      this.statusTarget.textContent = "This link is incomplete. Reopen the complete ISP email link or request a new one."
    }
  }
}
