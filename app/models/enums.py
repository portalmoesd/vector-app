import enum


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    DEPUTY = "DEPUTY"
    SUPERVISOR = "SUPERVISOR"
    SUPER_COLLABORATOR = "SUPER_COLLABORATOR"
    COLLABORATOR = "COLLABORATOR"


class DocumentSubmitterRole(str, enum.Enum):
    DEPUTY = "DEPUTY"
    SUPERVISOR = "SUPERVISOR"
    SUPER_COLLABORATOR = "SUPER_COLLABORATOR"


class EventStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    ARCHIVED = "ARCHIVED"


class SectionStatus(str, enum.Enum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    APPROVED = "APPROVED"
    RETURNED = "RETURNED"


class WorkflowStepStatus(str, enum.Enum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    APPROVED = "APPROVED"
    RETURNED = "RETURNED"
