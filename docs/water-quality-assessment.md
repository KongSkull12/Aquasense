# AquaSense water-quality assessment guidance

## Scope

The dashboard uses parameter-specific **production guidance** for temperature and pH. These are advisory comparisons, not emergency limits, mortality probabilities, or inputs to a composite Risk Index. An observation is compared with the guidance only when the backend marks the sensor measurement valid, stable, and calibrated. Until then the dashboard shows its value with a calibration-required / unclassified state.

| Parameter | Dashboard guidance | Interpretation |
| --- | --- | --- |
| Temperature | 26–29 °C | Queensland aquaculture guidance describes this as the optimal growth range. It is not a survival boundary; studies vary by life stage and production objective. |
| pH | 7.0–8.5 | Queensland culture guidance. The reported shell-hardening/moulting concern below pH 7 is conditional on hardness also being below 50 mg/L; AquaSense does not measure hardness, so it does not assert that condition. |
| Turbidity | No numeric NTU classification | No species-specific NTU threshold is established here. TSS measurements from particular biofloc systems are not converted to NTU. The sensor may be trended only when its NTU conversion is commissioned. |
| ORP | No numeric classification | Independent redox measurement in mV. No species-specific threshold is established here; ORP is never converted to dissolved oxygen. |

The Queensland values concern aquaculture production guidance. They do not establish universal safe/unsafe boundaries across life stages, tank systems, acclimation, or exposure duration. The dashboard must keep that context visible and must not turn these ranges into a weighted score.

## TAN and freshwater NH3-N

A TAN entry records a measured result, its source, the sample collection time, server-recorded entry time, submitting user, and user-supplied method/evidence reference. `USER_ATTESTED` means the submitter attested to the entry and supplied evidence text; AquaSense has not independently verified the test method or laboratory report.

The entry time does not alter the sample time. NH3-N calculation pairs the TAN sample time with pH and temperature acquisition times from the same registered device. All three timestamps must be within 15 seconds pairwise, and the pH and temperature records must pass the backend's freshness, stability, and calibration eligibility checks. Delayed entry is therefore supported without using newer sensor readings as if they belonged to the older sample.

For freshwater, the backend calculates:

```text
pKa = 0.09018 + 2729.92 / (273.2 + temperature_C)
NH3 fraction = 1 / (1 + 10^(pKa - pH))
NH3-N (mg/L as N) = measured TAN (mg/L as N) * NH3 fraction
```

The stored TAN value is never derived from pH or temperature. Missing, unaligned, or ineligible inputs leave NH3-N unavailable. This is a speciation estimate, not a toxicity or mortality prediction.

## Risk status

The composite Risk Index, mortality probability, and time-to-critical estimate remain unavailable. The current evidence does not justify weights or severity bands combining temperature, pH, turbidity, and ORP for Australian Red Claw crayfish. Missing TAN is an unassessed ammonia hazard, not zero risk. None of these dashboard advisories issues pump, aerator, or feeder commands.

## References

- Queensland Government, [Redclaw crayfish aquaculture](https://www.business.qld.gov.au/industries/farms-fishing-forestry/fisheries/aquaculture/species/redclaw-crayfish).
- García-Guerrero et al. (2013), [Effect of temperature on weight increase, survival, and thermal preference of juvenile redclaw crayfish](https://www.scielo.org.mx/scielo.php?pid=S0188-88972013000100007&script=sci_arttext).
- Haubrock et al. (2021), [The redclaw crayfish: A prominent aquaculture species with invasive potential](https://doi.org/10.1111/raq.12531).
- ANZG, [Ammonia in freshwater technical brief](https://www.waterquality.gov.au/sites/default/files/documents/ammonia-fresh-dgvs-technical-brief.pdf).
- US EPA, [Field measurement of oxidation-reduction potential](https://www.epa.gov/quality/field-measurement-oxidation-reduction-potential).
- Ruan et al. (2025), [TSS-optimized biofloc study in juvenile redclaw](https://doi.org/10.1007/s10499-025-02291-3). This study reports TSS for a particular culture setup and does not define an NTU threshold.
