# datasets Specification

## Purpose

Provide versioned datasets, the unit an evaluation run evaluates against. A
dataset is a named collection of items (each an `input` with optional
`expectedOutput`, `tags`, and `slice`) that hosts create, add to, list,
version, and archive.

## Requirements
### Requirement: Create a dataset

The system SHALL create a versioned dataset identified by a name, starting
at version 1, with an optional set of initial items. A dataset is the unit
a run evaluates against.

#### Scenario: Create an empty dataset

- **WHEN** a host creates a dataset with a name and no items
- **THEN** a dataset row is created at version 1 with an item count of 0 and
  not archived

#### Scenario: Create a dataset with initial items

- **WHEN** a host creates a dataset with a name and a list of items
- **THEN** the dataset is created and each item is stored against it, and
  the dataset's item count reflects the number of items added

### Requirement: Add and list dataset items

The system SHALL let a host add items to a dataset and list them. Each item
carries an `input` and optional `expectedOutput`, `tags`, and `slice`.

#### Scenario: Add items to an existing dataset

- **WHEN** a host adds items to a dataset
- **THEN** the items are stored against that dataset and the dataset's item
  count increases by the number added

#### Scenario: List a dataset's items

- **WHEN** a host lists the items of a dataset
- **THEN** it receives every item belonging to that dataset and no items
  from any other dataset

### Requirement: Version a dataset

The system SHALL snapshot a dataset into a new version that links to its
parent version and carries a copy of the parent's items, so that a run can
pin a specific, immutable dataset version.

#### Scenario: Snapshot a new version

- **WHEN** a host versions an existing dataset
- **THEN** a new dataset row is created with an incremented version, a
  reference to the parent version, and a copy of the parent's items

### Requirement: List and archive datasets

The system SHALL list datasets and let a host archive a dataset. Archived
datasets are excluded from the default listing.

#### Scenario: Archive a dataset

- **WHEN** a host archives a dataset
- **THEN** the dataset is marked archived and is omitted from the default
  dataset listing

#### Scenario: List active datasets

- **WHEN** a host lists datasets without requesting archived ones
- **THEN** it receives only datasets that are not archived

