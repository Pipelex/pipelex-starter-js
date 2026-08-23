import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    // The form kernel's controls ship as compiled JS: their Tailwind classes
    // live in the package bundle, outside every source glob above. Without this
    // entry the form still renders — only the classes unique to the controls are
    // purged, which reads as a broken design system, not a missing glob.
    // `docs/input-form.md` has the deterministic check for it.
    "./node_modules/@pipelex/mthds-form/dist/**/*.js",
  ],
  theme: {
    extend: {
      // The shadcn semantic token contract the kernel's controls are written
      // against, mirrored from `@pipelex/mthds-form`'s own tailwind.config.cjs.
      // The values come from `@pipelex/mthds-form/theme.css`, imported in
      // `src/app/layout.tsx`.
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  // The select popover's enter/exit utilities come from this plugin.
  plugins: [tailwindcssAnimate],
};

export default config;
