import React from "react";
import { useI18n } from "../contexts/I18nContext";

export function TermsPage({ onNavigate }) {
  const { t, lang } = useI18n();

  if (lang === "en") {
    return (
      <div className="container">
        <div className="terms-page">
          <button className="back-button" onClick={() => onNavigate("discover")}>{t("detail.back")}</button>
          <h1>Terms and Conditions of Sale</h1>
          <p className="terms-updated">Last updated: February 2026</p>

          <h2>1. Parties</h2>
          <p>
            These terms apply to ticket purchases made through Hapn, operated by
            <strong> Hatteland AS</strong>, org. no. 928 256 545, Herslebs gate 17 B, 0561 Oslo.
            Email: kristian.hatteland@gmail.com.
          </p>
          <p>
            The buyer is the person who places the order. The buyer must be at least 18 years old,
            or have parental/guardian consent where applicable.
          </p>

          <h2>2. Payment</h2>
          <p>
            Payment is processed securely through Vipps MobilePay. The total amount, including any fees,
            is displayed before purchase confirmation. Payment is charged immediately upon confirmation.
            For free events, no payment is required.
          </p>

          <h2>3. Delivery</h2>
          <p>
            Tickets are delivered digitally via the Hapn platform immediately after confirmed payment.
            A QR code ticket is displayed in your account under "My Tickets" and can be presented
            at the venue for check-in.
          </p>

          <h2>4. Right of withdrawal (Angrerett)</h2>
          <p>
            In accordance with the Norwegian Right of Withdrawal Act (Angrerettloven) section 22,
            the right of withdrawal does not apply to tickets for events, performances, or similar activities
            at a specific time or within a specific period. This means purchased tickets are non-refundable
            under the right of withdrawal.
          </p>

          <h2>5. Cancellation and changes</h2>
          <p>
            Tickets can be cancelled through "My Tickets" on the Hapn platform before the event starts.
            For paid tickets, a refund will be issued via Vipps to the original payment method.
            Refunds are processed within 5-10 business days. The event organizer or venue may set
            specific cancellation policies that apply in addition to these terms.
          </p>
          <p>
            If an event is cancelled by the organizer, all ticket holders will receive a full refund automatically.
          </p>

          <h2>6. Returns</h2>
          <p>
            As tickets are digital products for time-bound events, physical returns do not apply.
            See section 5 for cancellation and refund policy.
          </p>

          <h2>7. Complaints (Reklamasjon)</h2>
          <p>
            If you experience issues with your ticket or the event does not match the description,
            please contact us at <a href="mailto:kristian.hatteland@gmail.com">kristian.hatteland@gmail.com</a>.
            Complaints should be submitted as soon as possible and no later than a reasonable time
            after you discovered or should have discovered the issue. We will respond within 14 days.
          </p>

          <h2>8. Conflict resolution</h2>
          <p>
            Disputes shall first be attempted resolved through dialogue between the parties.
            If no agreement is reached, the matter can be brought before the Norwegian Consumer Council
            (Forbrukerrådet) or the Consumer Disputes Commission (Forbrukerklageutvalget).
            See <a href="https://www.forbrukerradet.no" target="_blank" rel="noopener noreferrer">forbrukerradet.no</a> for
            more information. The European Commission's dispute resolution portal can be found
            at <a href="https://ec.europa.eu/odr" target="_blank" rel="noopener noreferrer">ec.europa.eu/odr</a>.
          </p>

          <h2>9. Age restrictions</h2>
          <p>
            Some events and venues have age restrictions. Your age is verified through Vipps login.
            If you do not meet the age requirement, you will not be able to purchase tickets for
            the restricted event or venue.
          </p>

          <h2>10. Privacy</h2>
          <p>
            We collect and process personal data necessary to fulfill ticket purchases and
            provide our services. Data from Vipps login (name, email, phone number, date of birth)
            is stored securely and used only for account management, age verification, and order processing.
            We do not share personal data with third parties beyond what is necessary for payment processing.
          </p>
        </div>
      </div>
    );
  }

  // Norwegian (default)
  return (
    <div className="container">
      <div className="terms-page">
        <button className="back-button" onClick={() => onNavigate("discover")}>{t("detail.back")}</button>
        <h1>Salgsvilkår</h1>
        <p className="terms-updated">Sist oppdatert: Februar 2026</p>

        <h2>1. Parter</h2>
        <p>
          Disse vilkårene gjelder for billettkjøp gjennom Hapn, drevet av
          <strong> Hatteland AS</strong>, org.nr. 928 256 545, Herslebs gate 17 B, 0561 Oslo.
          E-post: kristian.hatteland@gmail.com.
        </p>
        <p>
          Kjøper er den personen som legger inn bestillingen. Kjøper må være minst 18 år,
          eller ha samtykke fra foresatte der det er relevant.
        </p>

        <h2>2. Betaling</h2>
        <p>
          Betaling gjennomføres sikkert via Vipps MobilePay. Totalbeløpet, inkludert eventuelle gebyrer,
          vises før kjøpsbekreftelse. Betaling trekkes umiddelbart ved bekreftelse.
          For gratisarrangementer kreves ingen betaling.
        </p>

        <h2>3. Levering</h2>
        <p>
          Billetter leveres digitalt via Hapn-plattformen umiddelbart etter bekreftet betaling.
          En QR-kodebillett vises på kontoen din under «Mine billetter» og kan presenteres
          på utestedet for innsjekking.
        </p>

        <h2>4. Angrerett</h2>
        <p>
          I henhold til Angrerettloven § 22 gjelder ikke angreretten for billetter til arrangementer,
          forestillinger eller lignende aktiviteter på et bestemt tidspunkt eller innenfor en bestemt periode.
          Dette betyr at kjøpte billetter ikke kan returneres med hjemmel i angreretten.
        </p>

        <h2>5. Avbestilling og endring</h2>
        <p>
          Billetter kan kanselleres via «Mine billetter» på Hapn-plattformen før arrangementet starter.
          For betalte billetter vil refusjon bli utstedt via Vipps til opprinnelig betalingsmetode.
          Refusjoner behandles innen 5–10 virkedager. Arrangøren eller utestedet kan sette
          spesifikke avbestillingsregler som gjelder i tillegg til disse vilkårene.
        </p>
        <p>
          Dersom et arrangement avlyses av arrangøren, vil alle billettinnehavere få full refusjon automatisk.
        </p>

        <h2>6. Retur</h2>
        <p>
          Ettersom billetter er digitale produkter for tidsbestemte arrangementer, gjelder ikke fysisk retur.
          Se punkt 5 for avbestilling og refusjonsvilkår.
        </p>

        <h2>7. Reklamasjon</h2>
        <p>
          Dersom du opplever problemer med billetten din, eller arrangementet ikke samsvarer med beskrivelsen,
          ta kontakt med oss på <a href="mailto:kristian.hatteland@gmail.com">kristian.hatteland@gmail.com</a>.
          Reklamasjoner bør sendes så snart som mulig og senest innen rimelig tid etter at du oppdaget
          eller burde ha oppdaget mangelen. Vi svarer innen 14 dager.
        </p>

        <h2>8. Konfliktløsning</h2>
        <p>
          Tvister skal først forsøkes løst gjennom dialog mellom partene.
          Dersom enighet ikke oppnås, kan saken bringes inn for Forbrukerrådet
          eller Forbrukerklageutvalget.
          Se <a href="https://www.forbrukerradet.no" target="_blank" rel="noopener noreferrer">forbrukerradet.no</a> for
          mer informasjon. EU-kommisjonens klageportal finner du
          på <a href="https://ec.europa.eu/odr" target="_blank" rel="noopener noreferrer">ec.europa.eu/odr</a>.
        </p>

        <h2>9. Aldersgrenser</h2>
        <p>
          Noen arrangementer og utesteder har aldersgrenser. Din alder verifiseres gjennom Vipps-innlogging.
          Dersom du ikke oppfyller alderskravet, vil du ikke kunne kjøpe billetter til
          det aktuelle arrangementet eller utestedet.
        </p>

        <h2>10. Personvern</h2>
        <p>
          Vi samler inn og behandler personopplysninger som er nødvendig for å gjennomføre billettkjøp
          og levere våre tjenester. Data fra Vipps-innlogging (navn, e-post, telefonnummer, fødselsdato)
          lagres sikkert og brukes kun til kontoadministrasjon, aldersverifisering og ordrebehandling.
          Vi deler ikke personopplysninger med tredjeparter utover det som er nødvendig for betalingsformidling.
        </p>
      </div>
    </div>
  );
}
