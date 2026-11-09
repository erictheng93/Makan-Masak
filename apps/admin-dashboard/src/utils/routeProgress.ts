import { ref } from "vue";

/** True from the first navigation guard until the route settles or fails. */
export const navigationPending = ref(false);
