import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SUPPORTED_LANGUAGES } from "@/constants/languages";
import { useLanguage } from "@/hooks/use-language";
import { resolveLanguage } from "@/lib/language";

export function LanguageSwitcher() {
  const { t } = useTranslation();
  const [language, setLanguage] = useLanguage();

  return (
    <Select
      value={language}
      onValueChange={(value) => setLanguage(resolveLanguage(value))}
    >
      <SelectTrigger
        aria-label={t("language.label")}
        className="h-8 shrink-0 cursor-pointer rounded-full border-input pr-1.5 pl-2.5 text-[13px] font-medium text-muted-foreground shadow-none hover:border-faint hover:text-foreground bg-transparent data-[size=default]:max-tablet:h-11"
      >
        <Languages className="size-3.5 shrink-0" aria-hidden="true" />
        <SelectValue>{t(`language.names.${language}`)}</SelectValue>
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="end"
        className="border border-input motion-reduce:animate-none"
      >
        <SelectGroup>
          {SUPPORTED_LANGUAGES.map((option) => (
            <SelectItem
              key={option}
              value={option}
              className="cursor-pointer max-tablet:min-h-11"
            >
              {t(`language.names.${option}`)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
