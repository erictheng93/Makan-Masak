import { onMounted, onUnmounted, ref } from "vue";

/**
 * Category chip strip + scroll-spy shared by MenuView and ShopMenuView.
 *
 * The spy highlights the last section whose top has crossed a third of the
 * viewport. A short trailing section (e.g. a one-dish 飲料) can never cross
 * that line because the page bottoms out first, so a tap on its chip used to
 * be overwritten by the section above it as soon as the smooth scroll emitted
 * its first scroll event. Two rules fix that:
 *   - a chip tap owns the highlight until the user scrolls by hand;
 *   - at the bottom of the page the last section wins.
 */
export function useCategoryScrollSpy(
  categoryIds: () => number[],
  elementId: (categoryId: number) => string,
) {
  const activeCategoryId = ref<number | null>(null);
  let tapLocked = false;

  const releaseTapLock = () => {
    tapLocked = false;
  };

  const updateActiveCategoryOnScroll = () => {
    if (tapLocked) return;

    const sections = categoryIds()
      .map((id) => ({ id, element: document.getElementById(elementId(id)) }))
      .filter((section) => section.element !== null);
    if (sections.length === 0) return;

    const atBottom =
      window.innerHeight + window.scrollY >=
      document.documentElement.scrollHeight - 2;
    if (atBottom) {
      activeCategoryId.value = sections[sections.length - 1].id;
      return;
    }

    for (let i = sections.length - 1; i >= 0; i--) {
      const rect = sections[i].element!.getBoundingClientRect();
      if (rect.top <= window.innerHeight / 3) {
        activeCategoryId.value = sections[i].id;
        return;
      }
    }
  };

  const scrollToCategory = (categoryId: number) => {
    activeCategoryId.value = categoryId;
    tapLocked = true;
    document.getElementById(elementId(categoryId))?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  // Input that means "the user is scrolling now", as opposed to our own
  // smooth scroll. touchstart/keydown fire before the chip's click, so a
  // second tap re-locks correctly.
  const userScrollEvents = ["wheel", "touchstart", "keydown"] as const;

  onMounted(() => {
    window.addEventListener("scroll", updateActiveCategoryOnScroll, {
      passive: true,
    });
    for (const event of userScrollEvents) {
      window.addEventListener(event, releaseTapLock, { passive: true });
    }
  });

  onUnmounted(() => {
    window.removeEventListener("scroll", updateActiveCategoryOnScroll);
    for (const event of userScrollEvents) {
      window.removeEventListener(event, releaseTapLock);
    }
  });

  return { activeCategoryId, scrollToCategory, updateActiveCategoryOnScroll };
}
