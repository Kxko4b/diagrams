(() => {
// Public review display and submission use the `message` field edited in admin.

const REVIEW_MAX_FILES = 10;
const REVIEW_MAX_BYTES = 25 * 1024 * 1024; // per file, matches the review-images bucket limit
const REVIEW_MAX_TOTAL_BYTES = 100 * 1024 * 1024; // all files in one review
const REVIEW_UPLOAD_TIMEOUT_MS = 120000;
const REVIEW_FILE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

function isVideoUrl(url) {
  try {
    return /\.(mp4|webm|mov|m4v)$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function buildReviewMedia(url, name) {
  if (isVideoUrl(url)) {
    const video = document.createElement("video");
    video.className = "review-image";
    video.src = url;
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.setAttribute("aria-label", `Video shared with ${name}'s review`);
    video.addEventListener(
      "error",
      () => {
        // Some browsers can't play every format (e.g. iPhone .mov in Chrome).
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Open video";
        video.replaceWith(link);
      },
      { once: true }
    );
    return video;
  }

  const image = document.createElement("img");
  image.className = "review-image";
  image.src = url;
  image.alt = `Photo shared with ${name}'s review`;
  image.loading = "lazy";
  image.addEventListener("error", () => image.remove(), { once: true });
  return image;
}

async function loadReviews() {
  const box = document.getElementById("review-list");
  if (!box) return;
  box.setAttribute("aria-busy", "true"); // the skeleton cards from the HTML stay visible until the data arrives

  const { data, error } = await db
    .from("reviews")
    .select("id, name, rating, message, image_url, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Could not load reviews:", error);
    box.removeAttribute("aria-busy");
    box.textContent = "Reviews are unavailable right now.";
    return;
  }

  // Extra files per review live in the review-images table.
  const mediaByReview = new Map();
  const { data: mediaRows, error: mediaError } = await db
    .from("review-images")
    .select("review_id, image_url")
    .order("id", { ascending: true });
  if (mediaError) {
    console.error("Could not load review files:", mediaError);
  } else {
    for (const row of mediaRows || []) {
      if (!mediaByReview.has(row.review_id)) mediaByReview.set(row.review_id, []);
      mediaByReview.get(row.review_id).push(row.image_url);
    }
  }

  box.replaceChildren();
  box.removeAttribute("aria-busy");
  if (!data?.length) {
    box.textContent = "No reviews yet.";
    return;
  }

  for (const review of data) {
    const card = document.createElement("article");
    card.className = "card review";
    const authorName = review.name || "Anonymous";

    // Old reviews only have image_url; newer ones have rows in review-images.
    const urls = mediaByReview.get(review.id) || (review.image_url ? [review.image_url] : []);
    if (urls.length) {
      const media = document.createElement("div");
      media.className = urls.length === 1 ? "review-media single" : "review-media";
      for (const url of urls) media.append(buildReviewMedia(url, authorName));
      card.append(media);
    }

    const stars = document.createElement("div");
    stars.className = "stars";
    const rating = Math.max(0, Math.min(5, Number(review.rating) || 0));
    stars.textContent = "★".repeat(rating) + "☆".repeat(5 - rating);
    const message = document.createElement("p");
    message.textContent = `“${review.message || ""}”`;
    const name = document.createElement("strong");
    name.textContent = `— ${authorName}`;
    card.append(stars, message, name);
    box.append(card);
  }
}

let reviewRating = 0;
const starsWrap = document.getElementById("review-stars");
starsWrap?.querySelectorAll("button").forEach((button) => {
  button.addEventListener("click", () => {
    reviewRating = Number(button.dataset.value) || 0;
    starsWrap.querySelectorAll("button").forEach((star) => {
      star.classList.toggle("on", Number(star.dataset.value) <= reviewRating);
      star.setAttribute("aria-pressed", String(Number(star.dataset.value) === reviewRating));
    });
  });
});

document.getElementById("review-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const msg = document.getElementById("review-msg");
  const button = form.querySelector('[type="submit"]');
  const showMessage = (text, isError = false) => {
    msg.textContent = text;
    msg.classList.remove("hidden", "error", "moss");
    msg.classList.add(isError ? "error" : "moss");
  };

  if (!reviewRating) {
    showMessage("Choose a star rating first.", true);
    return;
  }

  const files = Array.from(document.getElementById("review-image").files);
  if (files.length > REVIEW_MAX_FILES) {
    showMessage(`You can attach up to ${REVIEW_MAX_FILES} files.`, true);
    return;
  }
  let totalBytes = 0;
  for (const file of files) {
    if (!REVIEW_FILE_TYPES[file.type]) {
      showMessage("Choose PNG, JPEG, WebP, GIF, MP4, WebM, or MOV files only.", true);
      return;
    }
    if (file.size > REVIEW_MAX_BYTES) {
      showMessage(`"${file.name}" is too large. The limit is 25 MB per file.`, true);
      return;
    }
    totalBytes += file.size;
  }
  if (totalBytes > REVIEW_MAX_TOTAL_BYTES) {
    showMessage("Those files add up to more than 100 MB. Please attach fewer or smaller files.", true);
    return;
  }

  button.disabled = true;

  try {
    const uploadedUrls = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      showMessage(
        files.length > 1
          ? `Uploading file ${i + 1} of ${files.length}…`
          : file.type.startsWith("video/")
            ? "Uploading video… this can take a moment."
            : "Uploading…"
      );
      const path = `${crypto.randomUUID()}.${REVIEW_FILE_TYPES[file.type]}`;
      const { error: uploadError } = await withTimeout(
        db.storage.from("review-images").upload(path, file, { contentType: file.type }),
        REVIEW_UPLOAD_TIMEOUT_MS,
        "Upload timed out"
      );
      if (uploadError) throw uploadError;
      uploadedUrls.push(db.storage.from("review-images").getPublicUrl(path).data.publicUrl);
    }

    showMessage("Sending review…");
    const { data: review, error } = await db
      .from("reviews")
      .insert({
        name: document.getElementById("review-name").value.trim().slice(0, 60),
        rating: reviewRating,
        message: document.getElementById("review-text").value.trim().slice(0, 500),
        image_url: uploadedUrls[0] || null, // first file, for older code and the admin panel
      })
      .select("id")
      .single();
    if (error) throw error;

    let filesSaved = true;
    if (uploadedUrls.length) {
      const { error: mediaError } = await db
        .from("review-images")
        .insert(uploadedUrls.map((url) => ({ review_id: review.id, image_url: url })));
      if (mediaError) {
        console.error("Could not save review files:", mediaError);
        filesSaved = false;
      }
    }

    form.reset();
    reviewRating = 0;
    starsWrap?.querySelectorAll("button").forEach((star) => {
      star.classList.remove("on");
      star.setAttribute("aria-pressed", "false");
    });
    showMessage(
      filesSaved
        ? "Thanks! Your review has been sent."
        : "Thanks! Your review was sent, but only the first file could be saved."
    );
    await loadReviews();
  } catch (err) {
    console.error("Could not submit review:", err);
    showMessage(
      files.length
        ? "Could not upload your files or submit the review. Try fewer or smaller files, or try again."
        : "Could not submit your review. Please try again.",
      true
    );
  } finally {
    button.disabled = false;
  }
});

window.loadReviews = loadReviews;
loadReviews();

// Update the public review cards immediately when a review or its media changes.
const publicReviewRealtime = db
  .channel("kxko-public-reviews-live")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "reviews" },
    () => loadReviews()
  )
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "review-images" },
    () => loadReviews()
  )
  .subscribe((status) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      console.warn("Live website reviews are temporarily unavailable:", status);
    }
  });
})();

