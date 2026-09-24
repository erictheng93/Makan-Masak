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
      platformHosted: "Platform-Hosted",
    },
    footer: {
      copyright: "© 2026 MakanMasak. All rights reserved.",
    },
  },

  home: {
    hero: {
      titleLine1: "Build Your Restaurant's",
      titleLine2: "Dedicated Management System",
      subtitle:
        "Platform-Hosted · Secure Data · Reviewed and Activated by Our Team",
      ctaApply: "Apply Now",
      ctaTour: "See how it works ↓",
    },
    features: {
      hosted: {
        title: "Platform-Hosted",
        description:
          "We run the system for you — no servers to set up or maintain",
      },
      secure: {
        title: "Secure & Reliable",
        description:
          "Built on Cloudflare's global edge network with enterprise-grade security.",
      },
      assisted: {
        title: "Assisted Activation",
        description:
          "Our team reviews your application, activates your account, and guides your shop setup",
      },
    },
    tour: {
      title: "From order to table, at a glance",
      subtitle:
        "These are real screens from the system, shown with a sample restaurant and sample orders.",
      steps: {
        order: {
          title: "Guests order by scanning",
          description:
            "Guests scan the QR code on the table and order from a menu with photos. No app to download.",
          alt: "The ordering screen on a guest's phone",
        },
        kitchen: {
          title: "The kitchen gets it instantly",
          description:
            "Orders appear on the kitchen tablet right away, sorted into waiting, cooking and ready.",
          alt: "The order board on the kitchen tablet",
        },
        tracking: {
          title: "Guests can follow along",
          description:
            "Guests see each step on their phone as it happens, so nobody has to ask if it's ready.",
          alt: "Order progress on a guest's phone",
        },
        dashboard: {
          title: "Owners see the takings",
          description:
            "Today's sales, order count and which tables are still waiting, all on one screen.",
          alt: "The owner overview in the admin dashboard",
        },
      },
    },
    cta: {
      title: "Ready to Get Started?",
      subtitle:
        "Fill out the application and our team will contact you after review.",
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
      address: { label: "Street Address", placeholder: "e.g. 1 Main Street" },
      district: { label: "District", placeholder: "e.g. Central District" },
      country: {
        label: "Country",
        placeholder: "Select a country",
        options: { TW: "Taiwan", MY: "Malaysia" },
      },
      city: { label: "City", placeholder: "Select a city" },
      market: {
        label: "Market or business district",
        independent: "I am an independent shop outside a market",
        fetchError: "Unable to load markets for this city. Please try again.",
      },
      stallNumber: {
        label: "Stall number (optional)",
        placeholder: "e.g. A-12",
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
      addressRequired: "Please enter the street address",
      countryRequired: "Please select a country",
      districtRequired: "Please enter the district",
      cityRequired: "Please enter the city",
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
      status: "Application Status",
      pendingReview: "Pending Platform Review",
    },
    nextSteps: {
      title: "What Happens Next?",
      email: {
        title: "Login Details",
        description:
          "Once approved, the platform will give you your owner account and a set-password link. Use the status link to follow your application.",
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
      viewStatus: "View Application Status",
    },
    statusLink: {
      savePrompt:
        "Save this link. It is the only way to check your application progress.",
      copy: "Copy status link",
    },
    contact: {
      prompt: "Any questions? Contact",
    },
  },
  status: {
    title: "Application Status",
    subtitle: "Check the latest review status for your restaurant application.",
    loading: "Loading application status...",
    businessName: "Restaurant Name",
    currentStatus: "Current Status",
    rejectionReason: "Reason for Rejection",
    lastUpdated: "Use refresh to check for the latest update.",
    refresh: "Refresh Status",
    backHome: "Back to Home",
    error: {
      missingLink: "This status link is incomplete.",
      invalidLink: "This status link is invalid.",
      unavailable:
        "We could not load this application. Please try again later.",
    },
    labels: {
      pending: "Pending Review",
      submitted: "Pending Review",
      approved: "Approved",
      provisioning: "Being Set Up",
      completed: "Activated",
      rejected: "Not Approved",
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
