const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

async function preparePhoto(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("JPG, PNG 또는 WebP 사진을 선택해 주세요.");
  }
  if (file.size > MAX_SOURCE_BYTES) throw new Error("20MB 이하 사진을 선택해 주세요.");

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  try {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }
  const photo = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!photo || photo.size > MAX_UPLOAD_BYTES) throw new Error("더 작은 사진을 선택해 주세요.");
  return photo;
}

class OngyeolSimulator extends HTMLElement {
  connectedCallback() {
    if (this.form) return;
    this.innerHTML = `
      <section class="og-sim">
        <h2>온결 현장 시뮬레이터</h2>
        <p>현장 사진 한 장으로 정리 후 모습을 살펴보세요.</p>
        <div class="og-grid">
          <form class="og-form" method="post">
            <label>현장 사진 <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required></label>
            <label>직원 초대 코드 <input name="staff" type="password" autocomplete="off" pattern="[a-f0-9]{48}" required placeholder="발급받은 초대 코드"></label>
            <p class="og-note">시안을 만들 때 사진이 OpenAI로 전송됩니다. 얼굴, 주소, 서류가 보이면 가린 뒤 올려 주세요.</p>
            <button type="submit" disabled>정리 후 시안 만들기</button>
            <p class="og-status" role="status" aria-live="polite"></p>
          </form>
          <div class="og-comparison">
            <figure><figcaption>Before · 현장 사진</figcaption><div class="og-frame"><img alt="정리 전 현장 사진" hidden><span>현장 사진을 선택해 주세요</span></div></figure>
            <figure><figcaption>After · AI 정리수납 시안</figcaption><div class="og-frame"><img alt="AI가 생성한 정리수납 시안" hidden><span>생성된 시안이 표시됩니다</span></div></figure>
          </div>
        </div>
      </section>`;
    this.form = this.querySelector("form");
    this.input = this.form.elements.photo;
    this.staff = this.form.elements.staff;
    this.button = this.querySelector("button");
    this.status = this.querySelector(".og-status");
    [this.before, this.after] = this.querySelectorAll(".og-frame");
    this.showExample(this.before, "example-before", "정리 전 예시 사진");
    this.showExample(this.after, "example-after", "AI 정리수납 예시 시안");
    this.input.addEventListener("change", () => this.selectPhoto());
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submit();
    });
  }

  disconnectedCallback() {
    this.controller?.abort();
    this.selection = undefined;
    this.photo = undefined;
    this.form?.reset();
    if (this.status) this.status.textContent = "";
    if (this.button) this.button.disabled = true;
    if (this.before) this.showExample(this.before, "example-before", "정리 전 예시 사진");
    if (this.after) this.showExample(this.after, "example-after", "AI 정리수납 예시 시안");
  }

  showImage(frame, source, description) {
    const image = frame.querySelector("img");
    if (image.getAttribute("src")?.startsWith("blob:")) URL.revokeObjectURL(image.src);
    if (source) {
      image.src = source instanceof Blob ? URL.createObjectURL(source) : source;
      image.alt = description;
    } else {
      image.removeAttribute("src");
    }
    image.hidden = !source;
    frame.querySelector("span").hidden = Boolean(source);
  }

  showExample(frame, attribute, description) {
    this.showImage(frame, this.getAttribute(attribute), description);
  }

  async selectPhoto() {
    const selection = {};
    this.selection = selection;
    this.photo = undefined;
    this.button.disabled = true;
    this.status.textContent = "";
    this.showImage(this.after);
    this.showImage(this.before);
    const file = this.input.files[0];
    if (!file) return;
    this.status.textContent = "사진을 읽고 있어요.";
    try {
      const photo = await preparePhoto(file);
      if (this.selection !== selection) return;
      this.photo = photo;
      this.showImage(this.before, photo, "정리 전 현장 사진");
      this.status.textContent = "";
      this.button.disabled = false;
    } catch (error) {
      if (this.selection !== selection) return;
      this.input.value = "";
      this.status.textContent = error instanceof DOMException
        ? "사진을 읽을 수 없습니다. 다른 사진을 선택해 주세요."
        : error.message;
    }
  }

  async submit() {
    if (!this.photo || this.controller) return;
    const endpoint = this.getAttribute("api-url");
    if (!endpoint || !endpoint.startsWith("https://")) {
      this.status.textContent = "시뮬레이터 서버 주소를 설정해 주세요.";
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    this.button.disabled = true;
    this.input.disabled = true;
    this.staff.disabled = true;
    this.form.setAttribute("aria-busy", "true");
    this.status.textContent = "정리 후 시안을 만들고 있어요.";
    this.showImage(this.after);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg", Authorization: "Bearer " + this.staff.value },
        credentials: "omit",
        redirect: "error",
        body: this.photo,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(165_000)])
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        this.status.textContent = error?.message ?? "시안을 만들 수 없습니다. 다시 시도해 주세요.";
        if (response.status === 401) this.staff.value = "";
        return;
      }
      if (response.headers.get("Content-Type") !== "image/jpeg") throw new Error("Unexpected response");
      const result = await response.blob();
      if (controller.signal.aborted) return;
      this.showImage(this.after, result, "AI가 생성한 정리수납 시안");
      this.status.textContent = "정리수납 시안이 완성됐어요.";
    } catch (error) {
      if (controller.signal.aborted) return;
      this.status.textContent = error.name === "TimeoutError"
        ? "응답 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요."
        : "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.";
    } finally {
      this.controller = undefined;
      this.input.disabled = false;
      this.staff.disabled = false;
      this.button.disabled = !this.photo;
      this.form.removeAttribute("aria-busy");
    }
  }
}

customElements.define("ongyeol-simulator", OngyeolSimulator);
