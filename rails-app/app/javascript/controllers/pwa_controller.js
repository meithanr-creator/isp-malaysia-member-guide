import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  connect() {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/service-worker", { scope: "/", updateViaCache: "none" }).catch(() => {
        // All application functions remain available without installation support.
      })
    }
  }
}
