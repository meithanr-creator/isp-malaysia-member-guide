import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["imageInput", "imagePreview", "existingImages", "brochureInput", "brochurePreview", "uploadStatus", "admission", "paid", "paymentMethod", "bank", "draftStatus"]

  connect() {
    this.imageUrls = []
    this.brochureUrl = null
    this.payment()
  }

  disconnect() {
    this.releaseImageUrls()
    if (this.brochureUrl) URL.revokeObjectURL(this.brochureUrl)
  }

  dirty(event) {
    if (this.hasDraftStatusTarget) {
      this.draftStatusTarget.textContent = "You have unsaved changes. Preview this draft again before publishing."
      this.draftStatusTarget.dataset.dirty = "true"
    }
    if (event?.target?.name === "event[remove_images][]" && this.hasImageInputTarget && this.imageInputTarget.files.length) this.images()
  }

  payment() {
    if (!this.hasAdmissionTarget || !this.hasPaidTarget) return
    const isPaid = this.admissionTarget.value === "paid"
    const isBank = isPaid && this.hasPaymentMethodTarget && this.paymentMethodTarget.value === "bank"
    this.paidTarget.hidden = !isPaid
    this.paidTarget.querySelectorAll("input, select, textarea").forEach((input) => { input.disabled = !isPaid })
    this.paidTarget.querySelectorAll("[data-required-when-paid]").forEach((input) => { input.required = isPaid })
    if (this.hasBankTarget) {
      this.bankTarget.hidden = !isBank
      this.bankTarget.querySelectorAll("input, select, textarea").forEach((input) => { input.disabled = !isBank })
      this.bankTarget.querySelectorAll("[data-required-when-bank]").forEach((input) => { input.required = isBank })
    }
  }

  images() {
    if (!this.hasImageInputTarget || !this.hasImagePreviewTarget) return
    const files = Array.from(this.imageInputTarget.files)
    const savedCount = this.hasExistingImagesTarget ? Number(this.existingImagesTarget.dataset.imageCount || 0) : 0
    const removedCount = this.hasExistingImagesTarget ? this.existingImagesTarget.querySelectorAll('input[type="checkbox"]:checked').length : 0
    const existingCount = Math.max(0, savedCount - removedCount)
    const tooMany = files.length + existingCount > 3
    const invalidType = files.find((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type))
    const tooLarge = files.find((file) => file.size > 5 * 1024 * 1024)
    let error = ""
    if (tooMany) error = `Choose up to ${Math.max(0, 3 - existingCount)} new image${3 - existingCount === 1 ? "" : "s"}, or mark a saved image for removal. Three images fit in each event.`
    else if (invalidType) error = `Choose a JPG, PNG or WebP image instead of ${invalidType.name}.`
    else if (tooLarge) error = `${tooLarge.name} is larger than 5 MB. Choose a smaller image.`
    this.imageInputTarget.setCustomValidity(error)
    this.releaseImageUrls()
    this.imagePreviewTarget.replaceChildren()
    if (error) { this.status(error, true); return }
    files.forEach((file, index) => {
      const url = URL.createObjectURL(file)
      this.imageUrls.push(url)
      const row = document.createElement("div")
      row.className = "upload-preview"
      const image = document.createElement("img")
      image.src = url
      image.alt = `Selected image: ${file.name}`
      const copy = document.createElement("div")
      const title = document.createElement("b")
      title.textContent = existingCount + index === 0 ? "New cover image" : "New gallery image"
      const filename = document.createElement("small")
      filename.textContent = `${file.name} · ${this.fileSize(file.size)}`
      const note = document.createElement("small")
      note.textContent = "Selected on this computer. Save the draft to attach."
      copy.append(title, filename, note)
      row.append(image, copy)
      this.imagePreviewTarget.append(row)
    })
    this.status(files.length ? `${files.length} image${files.length === 1 ? "" : "s"} ready for your draft.` : "Image selection cleared.")
  }

  brochure() {
    if (!this.hasBrochureInputTarget || !this.hasBrochurePreviewTarget) return
    const file = this.brochureInputTarget.files[0]
    if (this.brochureUrl) URL.revokeObjectURL(this.brochureUrl)
    this.brochureUrl = null
    this.brochurePreviewTarget.replaceChildren()
    let error = ""
    if (file && !(file.type === "application/pdf" || (!file.type && /\.pdf$/i.test(file.name)))) error = "Choose a PDF file for the event brochure."
    else if (file && file.size > 10 * 1024 * 1024) error = "This brochure is larger than 10 MB. Choose a smaller PDF."
    this.brochureInputTarget.setCustomValidity(error)
    if (error) { this.status(error, true); return }
    if (!file) { this.status("Brochure selection cleared."); return }
    this.brochureUrl = URL.createObjectURL(file)
    const row = document.createElement("div")
    row.className = "file-preview"
    const badge = document.createElement("span")
    badge.className = "pdf-badge"
    badge.textContent = "PDF"
    badge.setAttribute("aria-hidden", "true")
    const copy = document.createElement("div")
    const title = document.createElement("b")
    title.textContent = file.name
    const note = document.createElement("small")
    note.textContent = `${this.fileSize(file.size)} · selected on this computer`
    const link = document.createElement("a")
    link.className = "link-button"
    link.href = this.brochureUrl
    link.target = "_blank"
    link.rel = "noopener"
    link.textContent = "Open selected PDF"
    link.setAttribute("aria-label", "Open selected PDF in a new tab")
    copy.append(title, note, link)
    row.append(badge, copy)
    this.brochurePreviewTarget.append(row)
    this.status("PDF brochure ready. Save the draft to attach it.")
  }

  status(message, error = false) {
    if (!this.hasUploadStatusTarget) return
    this.uploadStatusTarget.textContent = message
    this.uploadStatusTarget.dataset.error = String(error)
  }

  releaseImageUrls() {
    this.imageUrls?.forEach((url) => URL.revokeObjectURL(url))
    this.imageUrls = []
  }

  fileSize(bytes) {
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
}