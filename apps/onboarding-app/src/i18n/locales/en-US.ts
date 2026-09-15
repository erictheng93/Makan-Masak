import type { Messages } from "../types";

const enUS: Messages = {
  common: {
    back: "Back",
    cancel: "Cancel",
    submit: "Submit",
    loading: "Loading...",
    toast: {
      copiedToClipboard: "Copied to clipboard",
    },
  },

  app: {
    tagline: {
      selfHosted: "Self-Hosted",
    },
    footer: {
      copyright: "© 2026 MakanMasak. All rights reserved.",
    },
  },

  home: {
    hero: {
      titleLine1: "Build Your Restaurant's",
      titleLine2: "Dedicated Management System",
      subtitle: "Self-Hosted · Secure Data · Launch in 24 Hours",
      ctaApply: "Apply Now",
      ctaDemo: "View Demo →",
    },
    features: {
      isolated: {
        title: "Isolated Environment",
        description:
          "Fully isolated cloud environment. Your data is 100% yours.",
      },
      secure: {
        title: "Secure & Reliable",
        description:
          "Built on Cloudflare's global edge network with enterprise-grade security.",
      },
      fast: {
        title: "Fast Deployment",
        description: "Automated deployment pipeline. Live within 24 hours.",
      },
    },
    cta: {
      title: "Ready to Get Started?",
      subtitle:
        "Fill out the application and we'll contact you within 24 hours.",
      button: "Start Application",
    },
  },

  apply: {
    title: "Application Form",
    form: {
      businessName: {
        label: "Restaurant Name",
        placeholder: "e.g. Royal Kitchen",
      },
      contactName: {
        label: "Contact Name",
        placeholder: "Your name",
      },
      contactEmail: {
        label: "Email",
        placeholder: "your@email.com",
      },
      contactPhone: {
        label: "Phone",
        placeholder: "+1-234-567-8900",
      },
      location: {
        label: "Restaurant Location",
        help: "Used for night market / district discovery and nearby search. Use the actual storefront or stall coordinates.",
        useCurrent: "Use Current Location",
        locating: "Locating...",
        unsupported:
          "This browser does not support geolocation. Enter coordinates manually.",
        failure:
          "Unable to get your current location. Check location permission or enter coordinates manually.",
        latitudePlaceholder: "Latitude, e.g. 24.147736",
        longitudePlaceholder: "Longitude, e.g. 120.673648",
      },
      subdomain: {
        label: "Desired URL (Optional)",
        placeholder: "yourrestaurant",
        available: "This URL is available",
        taken: "This URL is already taken",
        invalidFormat: "Only lowercase letters, numbers, and hyphens allowed",
        emptyHint: "Leave blank to auto-generate",
        suggestionsLabel: "Suggested alternatives:",
      },
      submitting: "Submitting...",
      next: "Next",
    },
    validation: {
      businessNameRequired: "Please enter a restaurant name",
      contactNameRequired: "Please enter a contact name",
      emailRequired: "Please enter an email",
      emailInvalid: "Please enter a valid email",
      phoneRequired: "Please enter a phone number",
      latitudeRequired: "Please enter the restaurant latitude",
      latitudeInvalid: "Latitude must be between -90 and 90",
      longitudeRequired: "Please enter the restaurant longitude",
      longitudeInvalid: "Longitude must be between -180 and 180",
      subdomainInvalidFormat:
        "Only lowercase letters, numbers, and hyphens allowed",
      subdomainTooShort: "Must be at least 3 characters",
      subdomainTaken: "This URL is already taken",
    },
    toast: {
      submitSuccess: "Application submitted",
      submitFailureFallback: "Submission failed. Please try again later.",
    },
  },

  success: {
    title: "Application Submitted!",
    subtitleLine1: "We've received your restaurant application.",
    subtitleLine2:
      "After platform review, we'll activate your account and hosted resources.",
    summary: {
      title: "Application Summary",
      applicationId: "Application ID",
      tenantId: "Tenant ID",
      businessName: "Restaurant Name",
      contactEmail: "Contact Email",
      plan: "Selected Plan",
      subdomain: "Dedicated URL",
      cloudflare: "Platform Hosting",
      connected: "Enabled",
      status: "Application Status",
      pendingReview: "Pending Platform Review",
    },
    nextSteps: {
      title: "What Happens Next?",
      email: {
        title: "Confirmation Email",
        prefix: "We've sent a confirmation email to",
        suffix: ". Please check your inbox.",
      },
      deploy: {
        title: "Platform Review",
        description:
          "The platform team will review your restaurant details and plan, then activate platform-hosted resources after approval.",
      },
      start: {
        title: "Get Started",
        description:
          "Once you receive your login details, you can immediately access the admin dashboard and start configuring your restaurant.",
      },
    },
    button: {
      goToAdmin: "Go to Admin Dashboard",
      backHome: "Back to Home",
    },
    contact: {
      prompt: "Any questions? Contact",
    },
  },

  plans: {
    trial: "Free trial",
    standard: "Standard",
    professional: "Professional",
    enterprise: "Enterprise",
  },
};

export default enUS;
