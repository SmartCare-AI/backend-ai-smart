# The disease table (`specialty_map.csv`)

This table is the only place where medical knowledge enters the models. Every
training row is a symptom description labelled with a disease; this table turns
the disease into the two things the service predicts:

- **specialty** — which department the patient should be routed to;
- **acuity** — how urgent the condition is, which becomes the risk label.

83 diseases: 41 from the two Kaggle datasets, 42 from DDXPlus.

## How it was reviewed

**Who.** The table was drafted and reviewed with an AI assistant against the
references below. It has **not** been signed off by a clinician. If the
committee asks, that is the answer; a supervisor with a medical background can
check it in one sitting, because every row carries its reason.

**Specialty.** Each disease has its ICD-10 code (`icd10` column). The ICD-10
chapter gives the body system, and the specialty is the department that
treats that system (chapter XI, digestive → gastroenterology). Where the
chapter and the treating department differ, the `note` column says why (viral
hepatitis is in the infectious chapter but is managed by hepatology, part of
gastroenterology). ICD-10 codes for DDXPlus conditions are the ones published
with that dataset.

The table has no paediatrics or emergency-medicine class, so childhood
illnesses (croup, bronchiolitis) are routed by organ system, and emergencies
are handled by the CRITICAL level, not by a specialty.

**Acuity.** Four levels, defined by what the patient should do:

| Level | Meaning | Examples |
|---|---|---|
| CRITICAL | Life-threatening — emergency care now | heart attack, brain hemorrhage, anaphylaxis |
| HIGH | Needs a doctor the same day; can deteriorate | pneumonia, malaria, hypoglycemia |
| MODERATE | Needs an appointment in the coming days | asthma, migraine, urinary tract infection |
| LOW | Self-limiting, or routine non-urgent care | common cold, acne, reflux |

- Kaggle diseases (`basis` = "reviewed"): assigned against these definitions.
- DDXPlus conditions: start from the severity rating its authors published
  with the dataset (1 = most severe … 5 = least): 1 → CRITICAL, 2 → HIGH,
  3–4 → MODERATE, 5 → LOW.
- Eight DDXPlus ratings were changed where a clinical reference clearly puts
  the condition at another level. They are marked "raised" or "lowered" in
  `basis`, with the reference in `note`.

## Changes made in the review

| Disease | Change | Reason |
|---|---|---|
| pulmonary embolism | HIGH → CRITICAL | NHS: "can be life-threatening if not treated quickly"; call 999 for severe difficulty breathing or chest pain |
| epiglottitis | HIGH → CRITICAL | NHS: "a medical emergency and needs to be treated in hospital straight away"; call 999 |
| unstable angina | HIGH → CRITICAL | Part of acute coronary syndrome; a medical emergency that can lead to heart attack |
| boerhaave (oesophageal rupture) | HIGH → CRITICAL | A surgical emergency with high mortality when treatment is delayed |
| viral pharyngitis | MODERATE → LOW | NHS: sore throats normally get better by themselves within a week |
| acute laryngitis | MODERATE → LOW | NHS: usually goes away by itself within 1 to 2 weeks |
| acute rhinosinusitis | MODERATE → LOW | NHS: usually clears up on its own within 4 weeks |
| allergic sinusitis | MODERATE → LOW | Same level as "allergy" elsewhere in the table |
| hepatitis c | HIGH → MODERATE | The dataset rows describe a chronic, non-acute picture |
| paroxysmal positional vertigo | neurology → otolaryngology | An inner-ear disorder (ICD-10 H81.1, diseases of the ear) |

Rows where the two sources disagreed and the more cautious level was kept:
pneumonia, tuberculosis and HIV / AIDS stay HIGH although DDXPlus rates them 3.

## What to check if a clinician reviews it

1. The eight changed DDXPlus ratings above.
2. Rows that are close calls: drug reaction (HIGH), stable angina (HIGH, from
   DDXPlus), atrial fibrillation and COPD exacerbation (MODERATE, from
   DDXPlus), scombroid food poisoning (specialty).
3. Whether "internal medicine" is the right stand-in for general practice in
   the Egyptian referral system.

After any edit: `python -m src.prepare && python -m src.train_specialty &&
python -m src.train_risk && python -m src.evaluate && pytest`.

## References

- World Health Organization, ICD-10 (codes and chapters).
- Fansi Tchango et al., "DDXPlus: A New Dataset for Automatic Medical
  Diagnosis", NeurIPS 2022 Datasets and Benchmarks — <https://arxiv.org/abs/2205.09148>
  (conditions file with ICD-10 codes and severity ratings).
- NHS, Pulmonary embolism — <https://www.nhs.uk/conditions/pulmonary-embolism/>
- NHS, Epiglottitis — <https://www.nhs.uk/conditions/epiglottitis/>
- NHS, Laryngitis — <https://www.nhs.uk/conditions/laryngitis/>
- NHS, Sinusitis — <https://www.nhs.uk/conditions/sinusitis/>
- NHS inform / NHS 111 Wales, Sore throat — <https://111.wales.nhs.uk/Sorethroat/>
- StatPearls, Unstable Angina — <https://statpearls.com/physician/cme/activity/86732>
- StatPearls, Boerhaave Syndrome — <https://www.ncbi.nlm.nih.gov/books/NBK430808/>
